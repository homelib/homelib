import {
  type Device,
  type DeviceConstructor,
  type Endpoint,
  type EndpointConnection,
  type EndpointConnectionBinding,
  type EndpointReference,
  createEndpointConnectionBinding,
} from '@homelib/core';

import {
  type MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionResolvedResource,
  type MiotEndpointConnectionResource,
  type MiotEndpointConnectionTransports,
  createMiotEndpointConnectionResolvedMetadata,
} from './endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotSpecProperty,
  type MiotSpecService,
  assertMiotPropertySchema,
  resolveMiotPropertySchema,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

type ErasedMiotEndpoint = EndpointReference & {
  enqueueCommand(command: never): EndpointReference;
  bindConnection(connection: EndpointConnection<never> | undefined): void;
};

export type MiotEndpointConstructor<
  TEndpoint extends ErasedMiotEndpoint = ErasedMiotEndpoint,
> = abstract new (name?: string) => TEndpoint;

type MiotEndpointCommand<TEndpoint extends ErasedMiotEndpoint> = Parameters<
  TEndpoint['enqueueCommand']
>[0];

type MiotEndpointAcceptedConnection<TEndpoint extends ErasedMiotEndpoint> =
  Exclude<Parameters<TEndpoint['bindConnection']>[0], undefined>;

export type MiotEndpointConnectionConstructor<
  TEndpoint extends ErasedMiotEndpoint = ErasedMiotEndpoint,
> = {
  readonly Endpoint: MiotEndpointConstructor<TEndpoint>;
  readonly properties: MiotPropertySchema;
  new (
    provider: MiotProvider,
    metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
  ): MiotEndpointConnection<MiotEndpointCommand<TEndpoint>> &
    MiotEndpointAcceptedConnection<TEndpoint>;
};

type ValidMiotEndpointConnectionConstructor<
  TConnection extends MiotEndpointConnectionConstructor,
> =
  TConnection extends MiotEndpointConnectionConstructor<
    InstanceType<TConnection['Endpoint']>
  >
    ? TConnection
    : never;

type ValidMiotEndpointConnectionConstructors<
  TConnections extends readonly MiotEndpointConnectionConstructor[],
> = {
  readonly [
    TIndex in keyof TConnections
  ]: ValidMiotEndpointConnectionConstructor<TConnections[TIndex]>;
};

type MiotEndpointConnectionConstructorTuple = readonly [
  MiotEndpointConnectionConstructor,
  ...MiotEndpointConnectionConstructor[],
];

export type MiotLogicalDeviceEndpoint = {
  readonly endpoint: EndpointReference;
};

export type MiotLogicalDevice<
  TEndpoint extends MiotLogicalDeviceEndpoint = MiotLogicalDeviceEndpoint,
> = {
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
  readonly endpoints: readonly TEndpoint[];
};

export type MiotDeviceEndpointMatch<
  TEndpoint extends MiotLogicalDeviceEndpoint = MiotLogicalDeviceEndpoint,
> = {
  readonly endpoint: TEndpoint;
  readonly Connection: MiotEndpointConnectionConstructor;
  readonly resources: readonly [
    MiotEndpointConnectionResolvedResource,
    ...MiotEndpointConnectionResolvedResource[],
  ];
};

export type MiotDeviceMatch<
  TEndpoint extends MiotLogicalDeviceEndpoint = MiotLogicalDeviceEndpoint,
> = {
  readonly Device: DeviceConstructor<Device>;
  readonly endpoints: readonly MiotDeviceEndpointMatch<TEndpoint>[];
};

export type MiotPhysicalDevice = {
  readonly did: string;
  readonly model?: string;
};

export type MiotDeviceEndpointConnectionBinding = {
  readonly connection: MiotEndpointConnection<never>;
  readonly binding: EndpointConnectionBinding;
};

export class MiotDeviceRegistry {
  private readonly deviceConnectionMap = new Map<
    DeviceConstructor<Device>,
    readonly MiotEndpointConnectionConstructor[]
  >();

  register<const TConnections extends MiotEndpointConnectionConstructorTuple>(
    DeviceConstructor: DeviceConstructor<Device>,
    ...Connections: TConnections &
      ValidMiotEndpointConnectionConstructors<TConnections>
  ): void {
    if (this.deviceConnectionMap.has(DeviceConstructor)) {
      throw new TypeError('Duplicate MIoT device registration.');
    }

    if (Connections.length === 0) {
      throw new TypeError(
        'A MIoT device requires at least one endpoint connection.',
      );
    }

    const connectionSet = new Set<MiotEndpointConnectionConstructor>();
    const endpointSet = new Set<MiotEndpointConstructor>();

    for (const Connection of Connections) {
      if (connectionSet.has(Connection)) {
        throw new TypeError('Duplicate MIoT endpoint connection registration.');
      }

      assertMiotPropertySchema(Connection.properties);

      if (endpointSet.has(Connection.Endpoint)) {
        throw new TypeError(
          'A MIoT device endpoint is handled by multiple connections.',
        );
      }

      connectionSet.add(Connection);
      endpointSet.add(Connection.Endpoint);
    }

    const registeredConnections = [...Connections];

    this.deviceConnectionMap.set(DeviceConstructor, registeredConnections);
  }

  getEndpointConnection(
    deviceConstructors: readonly DeviceConstructor<Device>[],
    endpoint: EndpointReference,
  ): MiotEndpointConnectionConstructor | undefined {
    const registeredDevice = this.getRegisteredDevice(deviceConstructors);

    if (registeredDevice === undefined) {
      return undefined;
    }

    return registeredDevice.Connections.find(
      Connection => Connection.Endpoint === endpoint.constructor,
    );
  }

  match<TEndpoint extends MiotLogicalDeviceEndpoint>(
    device: MiotLogicalDevice<TEndpoint>,
    services: readonly MiotSpecService[],
  ): MiotDeviceMatch<TEndpoint> | undefined {
    const registeredDevice = this.getRegisteredDevice(
      device.deviceConstructors,
    );

    if (
      registeredDevice === undefined ||
      registeredDevice.Connections.length !== device.endpoints.length
    ) {
      return undefined;
    }

    const endpointMap = new Map<Function, TEndpoint>();

    for (const endpoint of device.endpoints) {
      const Endpoint = endpoint.endpoint.constructor;

      if (endpointMap.has(Endpoint)) {
        return undefined;
      }

      endpointMap.set(Endpoint, endpoint);
    }

    const matchMap = new Map<Function, MiotDeviceEndpointMatch<TEndpoint>>();
    const serviceIidSet = new Set<number>();

    for (const Connection of registeredDevice.Connections) {
      const endpoint = endpointMap.get(Connection.Endpoint);

      if (endpoint === undefined) {
        return undefined;
      }

      const resolvedResources = resolveMiotEndpointConnectionResources(
        Connection,
        services,
      );
      const [firstResource, ...remainingResources] = resolvedResources ?? [];

      if (firstResource === undefined) {
        return undefined;
      }

      const resources: [
        MiotEndpointConnectionResolvedResource,
        ...MiotEndpointConnectionResolvedResource[],
      ] = [firstResource, ...remainingResources];

      for (const {service} of resources) {
        if (serviceIidSet.has(service.iid)) {
          return undefined;
        }

        serviceIidSet.add(service.iid);
      }

      matchMap.set(Connection.Endpoint, {
        endpoint,
        Connection,
        resources,
      });
    }

    const endpointMatches: MiotDeviceEndpointMatch<TEndpoint>[] = [];

    for (const endpoint of device.endpoints) {
      const match = matchMap.get(endpoint.endpoint.constructor);

      if (match === undefined) {
        return undefined;
      }

      endpointMatches.push(match);
    }

    return {
      Device: registeredDevice.Device,
      endpoints: endpointMatches,
    };
  }

  private getRegisteredDevice(
    deviceConstructors: readonly DeviceConstructor<Device>[],
  ):
    | {
        readonly Device: DeviceConstructor<Device>;
        readonly Connections: readonly MiotEndpointConnectionConstructor[];
      }
    | undefined {
    const registeredDevices = deviceConstructors.flatMap(DeviceConstructor => {
      const Connections = this.deviceConnectionMap.get(DeviceConstructor);

      return Connections === undefined
        ? []
        : [{Device: DeviceConstructor, Connections}];
    });
    const [registeredDevice] = registeredDevices;

    return registeredDevices.length === 1 ? registeredDevice : undefined;
  }
}

const MIOT_DEVICE_REGISTRY = new MiotDeviceRegistry();

export function registerMiotDevice<
  const TConnections extends MiotEndpointConnectionConstructorTuple,
>(
  DeviceConstructor: DeviceConstructor<Device>,
  ...Connections: TConnections &
    ValidMiotEndpointConnectionConstructors<TConnections>
): void;
export function registerMiotDevice(
  DeviceConstructor: DeviceConstructor<Device>,
  ...Connections: MiotEndpointConnectionConstructorTuple
): void {
  MIOT_DEVICE_REGISTRY.register(DeviceConstructor, ...Connections);
}

export function matchMiotDevice<TEndpoint extends MiotLogicalDeviceEndpoint>(
  device: MiotLogicalDevice<TEndpoint>,
  services: readonly MiotSpecService[],
): MiotDeviceMatch<TEndpoint> | undefined {
  return MIOT_DEVICE_REGISTRY.match(device, services);
}

export function getMiotEndpointConnectionConstructor(
  deviceConstructors: readonly DeviceConstructor<Device>[],
  endpoint: EndpointReference,
): MiotEndpointConnectionConstructor | undefined {
  return MIOT_DEVICE_REGISTRY.getEndpointConnection(
    deviceConstructors,
    endpoint,
  );
}

export function createMiotDeviceEndpointConnectionBinding(
  Connection: MiotEndpointConnectionConstructor,
  provider: MiotProvider,
  endpoint: EndpointReference,
  metadata: MiotEndpointConnectionResolvedMetadata,
  transports: MiotEndpointConnectionTransports,
  disposeConnection?: (
    connection: MiotEndpointConnection<never>,
  ) => void | PromiseLike<void>,
): MiotDeviceEndpointConnectionBinding {
  if (endpoint.constructor !== Connection.Endpoint) {
    throw new TypeError('Endpoint does not match its MIoT connection.');
  }

  const connection = new Connection(provider, metadata, transports);

  return {
    connection,
    binding: createEndpointConnectionBinding(
      endpoint as Endpoint<never, MiotEndpointConnection<never>>,
      connection,
      () => disposeConnection?.(connection),
    ),
  };
}

export function resolveMiotEndpointConnectionResources(
  Connection: MiotEndpointConnectionConstructor,
  services: readonly MiotSpecService[],
): readonly MiotEndpointConnectionResolvedResource[] | undefined {
  return resolveMiotPropertySchema(services, Connection.properties);
}

export function resolvePersistedMiotEndpointConnectionResources(
  Connection: MiotEndpointConnectionConstructor,
  services: readonly MiotSpecService[],
): readonly MiotEndpointConnectionResolvedResource[] | undefined {
  return resolveMiotPropertySchema(services, Connection.properties, {
    allowMultipleOptionalServices: true,
  });
}

export function resolveMiotEndpointConnectionMetadata(
  Connection: MiotEndpointConnectionConstructor,
  metadata: MiotEndpointConnectionMetadata,
): MiotEndpointConnectionResolvedMetadata {
  const resources = resolvePersistedMiotEndpointConnectionResources(
    Connection,
    metadata.resources.map(resource => resource.service),
  );

  if (
    resources === undefined ||
    resources.length === 0 ||
    !resolvedResourcesMatchMetadata(resources, metadata.resources)
  ) {
    throw new TypeError('Invalid MIoT endpoint metadata.');
  }

  return createMiotEndpointConnectionResolvedMetadata(metadata, resources);
}

export function createMiotEndpointConnectionMetadata(
  device: MiotPhysicalDevice,
  urn: string,
  resources: readonly MiotEndpointConnectionResolvedResource[],
): MiotEndpointConnectionMetadata {
  return MiotEndpointConnectionMetadata.satisfies({
    device: {did: device.did, model: device.model, urn},
    resources: resources
      .toSorted(compareResources)
      .map(resource => ({service: resource.service})),
  });
}

export function miotEndpointConnectionMetadataEqual(
  left: MiotEndpointConnectionMetadata,
  right: MiotEndpointConnectionMetadata,
): boolean {
  return (
    left.device.did === right.device.did &&
    left.device.model === right.device.model &&
    left.device.urn === right.device.urn &&
    endpointResourcesEqual(left.resources, right.resources)
  );
}

function resolvedResourcesMatchMetadata(
  expected: readonly MiotEndpointConnectionResolvedResource[],
  actual: readonly MiotEndpointConnectionResource[],
): boolean {
  const actualResourceMap = new Map(
    actual.map(resource => [resource.service.iid, resource]),
  );

  return (
    expected.length === actual.length &&
    expected.every(expectedResource => {
      const actualResource = actualResourceMap.get(
        expectedResource.service.iid,
      );

      return (
        actualResource !== undefined &&
        serviceEqual(expectedResource.service, actualResource.service)
      );
    })
  );
}

function endpointResourcesEqual(
  left: readonly MiotEndpointConnectionResource[],
  right: readonly MiotEndpointConnectionResource[],
): boolean {
  return unorderedArraysEqual(left, right, (leftResource, rightResource) => {
    return serviceEqual(leftResource.service, rightResource.service);
  });
}

function serviceEqual(left: MiotSpecService, right: MiotSpecService): boolean {
  return (
    left.iid === right.iid &&
    left.type === right.type &&
    left.description === right.description &&
    optionalPropertyArraysEqual(left.properties, right.properties)
  );
}

function propertyEqual(
  left: MiotSpecProperty,
  right: MiotSpecProperty,
): boolean {
  return (
    left.iid === right.iid &&
    left.type === right.type &&
    left.description === right.description &&
    left.format === right.format &&
    left.unit === right.unit &&
    valueRangesEqual(left['value-range'], right['value-range']) &&
    valueListsEqual(left['value-list'], right['value-list']) &&
    stringSetsEqual(left.access, right.access)
  );
}

function optionalPropertyArraysEqual(
  left: readonly MiotSpecProperty[] | undefined,
  right: readonly MiotSpecProperty[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return unorderedArraysEqual(left, right, propertyEqual);
}

function valueRangesEqual(
  left: MiotSpecProperty['value-range'],
  right: MiotSpecProperty['value-range'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.every((value, index) => value === right[index]);
}

function valueListsEqual(
  left: MiotSpecProperty['value-list'],
  right: MiotSpecProperty['value-list'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return unorderedArraysEqual(left, right, (first, second) => {
    return (
      first.value === second.value && first.description === second.description
    );
  });
}

function stringSetsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every(value => rightSet.has(value))
  );
}

function unorderedArraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  valuesEqual: (left: T, right: T) => boolean,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const matchedIndexSet = new Set<number>();

  for (const leftValue of left) {
    const matchedIndex = right.findIndex((rightValue, index) => {
      return !matchedIndexSet.has(index) && valuesEqual(leftValue, rightValue);
    });

    if (matchedIndex === -1) {
      return false;
    }

    matchedIndexSet.add(matchedIndex);
  }

  return true;
}

function compareResources(
  left: MiotEndpointConnectionResolvedResource,
  right: MiotEndpointConnectionResolvedResource,
): number {
  return left.service.iid - right.service.iid;
}
