import assert from 'assert';
import {join, resolve} from 'path';

import {CommissioningController} from '@project-chip/matter-node.js';
import {
  StorageBackendDisk,
  StorageManager,
} from '@project-chip/matter-node.js/storage';
import {MatterServer} from '@project-chip/matter.js';
import type {EndpointNumber, NodeId} from '@project-chip/matter.js/datatype';
import type {Endpoint, PairedNode} from '@project-chip/matter.js/device';
import {ManualPairingCodeCodec} from '@project-chip/matter.js/schema';
import isTypeOfProperty from 'is-typeof-property';
import {observable} from 'mobx';

import {DataStore} from './data-store.js';
import {
  DEVICE_KEY,
  type DeviceEndpoint,
  type DeviceKey,
  type UnknownDevice,
} from './device/index.js';
import {ExpectedError} from './errors.js';
import type {Scope} from './scope.js';
import {UnlinkedDevice} from './unlinked-device.js';

const DATA_DIR_DEFAULT = resolve('.homelib/data');

export type ServerOptions = {
  /** Defaults to '.homelib/data' under cwd. */
  dataDir?: string;
};

export class Server {
  private dataStore: DataStore<ServerData>;

  private data: ServerData;

  private deviceMap = observable.map<DeviceKey, UnknownDevice>(undefined, {
    deep: false,
  });

  private deviceEndpointMap = observable.map<DeviceKey, DeviceEndpoint>(
    undefined,
    {deep: false},
  );

  private matterStorageManager: StorageManager;

  private matterServer: MatterServer;

  private commissioningController: CommissioningController;

  readonly options: Readonly<Required<ServerOptions>>;

  constructor(
    readonly scope: Scope,
    options: ServerOptions = {},
  ) {
    const {dataDir = DATA_DIR_DEFAULT} = options;

    this.options = {dataDir};

    const dataStore = new DataStore<ServerData>(join(dataDir, 'server'), () => {
      return {
        devices: {},
      };
    });

    this.dataStore = dataStore;
    this.data = dataStore.data;

    const matterStorage = new StorageBackendDisk(join(dataDir, 'matter'));

    this.matterStorageManager = new StorageManager(matterStorage);

    this.matterServer = new MatterServer(this.matterStorageManager);

    this.commissioningController = new CommissioningController({
      autoConnect: false,
    });
  }

  async start(): Promise<void> {
    const {
      matterStorageManager,
      matterServer,
      commissioningController,
      data,
      deviceMap,
    } = this;

    await matterStorageManager.initialize();

    matterServer.addCommissioningController(commissioningController);

    await matterServer.start();

    for (const [key, [scopePath, deviceName]] of Object.entries(
      data.devices,
    ) as [DeviceKey, DeviceScopePathAndName][]) {
      const device = this.scope._getDevice(scopePath, deviceName);

      if (device) {
        device._key = key;
        deviceMap.set(key, device);
      }
    }

    if (commissioningController.isCommissioned()) {
      const nodes = await commissioningController.connect();

      for (const node of nodes) {
        const {nodeId} = node;

        for (const [path, endpoint] of iterateNodeEndpoints(node)) {
          await this.handleDeviceEndpointConnect(endpoint, nodeId, path);
        }
      }
    }
  }

  getDeviceEndpoint(
    ...args:
      | [nodeId: NodeId, path: EndpointNumber[]]
      | [scopePath: string[], deviceName: string]
  ): DeviceEndpoint | undefined {
    const {deviceEndpointMap, scope} = this;

    const key = isTypeOfProperty(args, 0, 'bigint')
      ? DEVICE_KEY(...args)
      : scope._getDevice(...args)?._key;

    if (key === undefined) {
      return undefined;
    }

    return deviceEndpointMap.get(key);
  }

  async commission(pairingCode: string): Promise<void> {
    const {commissioningController} = this;

    const {shortDiscriminator, passcode} =
      ManualPairingCodeCodec.decode(pairingCode);

    assert(shortDiscriminator !== undefined);

    const node = await commissioningController.commissionNode({
      discovery: {
        identifierData: {
          shortDiscriminator,
        },
      },
      passcode,
    });

    const {nodeId} = node;

    for (const [path, endpoint] of iterateNodeEndpoints(node)) {
      await this.handleDeviceEndpointConnect(endpoint, nodeId, path);
    }
  }

  async link(
    device: UnknownDevice,
    nodeId: NodeId,
    path: EndpointNumber[],
  ): Promise<void> {
    const {commissioningController, data} = this;

    const node = commissioningController.getConnectedNode(nodeId);

    if (!node) {
      throw new NodeNotConnectedError(nodeId);
    }

    const [firstEndpointId, ...restEndpointIds] = path;

    let endpoint = node.getDeviceById(firstEndpointId);

    if (!endpoint) {
      throw new NodeDeviceNotFoundError(nodeId, path);
    }

    for (const endpointId of restEndpointIds) {
      endpoint = endpoint.getChildEndpoint(endpointId);

      if (!endpoint) {
        throw new NodeDeviceNotFoundError(nodeId, path);
      }
    }

    const key = DEVICE_KEY(nodeId, path);

    data.devices[key] = [device._requireScope()._path, device.name];

    await this.updateDeviceEndpoint(key, device, endpoint);
  }

  private async handleDeviceEndpointConnect(
    endpoint: Endpoint,
    nodeId: NodeId,
    path: EndpointNumber[],
  ): Promise<void> {
    const {deviceMap} = this;

    const key = DEVICE_KEY(nodeId, path);

    let device = deviceMap.get(key);

    if (!device) {
      device = new UnlinkedDevice('Unlinked Device');
      device._key = key;
      deviceMap.set(key, device);
    }

    await this.updateDeviceEndpoint(key, device, endpoint);
  }

  private async updateDeviceEndpoint(
    key: DeviceKey,
    device: UnknownDevice,
    endpoint: Endpoint,
  ): Promise<void> {
    const {deviceEndpointMap} = this;

    const obsoleteDeviceEndpoint = deviceEndpointMap.get(key);

    if (obsoleteDeviceEndpoint) {
      console.debug(
        `Device endpoint ${JSON.stringify(key)} already created, disposing...`,
      );
      await obsoleteDeviceEndpoint.dispose();
    }

    console.info(`Creating device endpoint ${JSON.stringify(key)}.`);

    const deviceEndpoint = await device.connect(endpoint);

    deviceEndpointMap.set(key, deviceEndpoint);
  }
}

type DeviceScopePathAndName = [scopePath: string[], deviceName: string];

type ServerData = {
  devices: Record<DeviceKey, DeviceScopePathAndName>;
};

function* iterateNodeEndpoints(
  node: PairedNode,
): IterableIterator<[path: EndpointNumber[], Endpoint]> {
  const endpoints = node.getDevices();

  for (const directEndpoint of endpoints) {
    yield* iterateEndpoints(directEndpoint);
  }
}

function* iterateEndpoints(
  endpoint: Endpoint,
): IterableIterator<[path: EndpointNumber[], Endpoint]> {
  const id = endpoint.getId();

  yield [[id], endpoint];

  const childEndpoints = endpoint.getChildEndpoints();

  for (const childEndpoint of childEndpoints) {
    for (const [path, endpoint] of iterateEndpoints(childEndpoint)) {
      yield [[id, ...path], endpoint];
    }
  }
}

export class NodeNotConnectedError extends ExpectedError {
  constructor(readonly nodeId: NodeId) {
    super(`Node ${nodeId} is not connected.`);
  }
}

export class NodeDeviceNotFoundError extends ExpectedError {
  constructor(
    readonly nodeId: NodeId,
    readonly path: number[],
  ) {
    super(`Device ${JSON.stringify(path)} not found on node ${nodeId}.`);
  }
}
