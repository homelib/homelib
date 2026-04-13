import * as ix from 'ix';

import type {DeviceProvider} from '../device-provider.js';
import type {Scope} from '../scope.js';

import type {ControllerStore} from './controller-store.js';

export class Controller {
  constructor(
    readonly store: ControllerStore,
    readonly scope: Scope,
    readonly deviceProviders: DeviceProvider[],
  ) {}

  async start(): Promise<void> {
    const deviceProviders = this.deviceProviders;

    if (deviceProviders.length === 0) {
      console.warn('No device providers found, cannot start controller.');
      return;
    }

    const [firstDeviceEndpointIterable, ...restDeviceEndpointIterables] =
      deviceProviders.map(deviceProvider => deviceProvider.iterateEndpoints());

    for await (const deviceEndpoint of ix.AsyncIterable.merge(
      firstDeviceEndpointIterable,
      ...restDeviceEndpointIterables,
    )) {
      const deviceDataItem = this.store.findDevice(deviceEndpoint.id);

      if (!deviceDataItem) {
        console.warn(
          `Device ${deviceEndpoint.constructor.name} ${deviceEndpoint.id} not found in store, skipping...`,
        );
        continue;
      }

      const device = this.scope._getDevice(
        deviceDataItem.path,
        deviceDataItem.name,
      );

      if (!device) {
        console.warn(
          `Device ${deviceEndpoint.constructor.name} ${deviceEndpoint.id} not found in scope, skipping...`,
        );
        continue;
      }

      device._endpoint = deviceEndpoint;

      deviceEndpoint.once('dispose', () => {
        if (device._endpoint === deviceEndpoint) {
          device._endpoint = undefined;
        }
      });
    }
  }
}
