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
    const [firstDeviceEndpointIterable, ...restDeviceEndpointIterables] =
      this.deviceProviders.map(deviceProvider =>
        deviceProvider.iterateEndpoints(),
      );

    for await (const deviceEndpoint of ix.AsyncIterable.merge(
      firstDeviceEndpointIterable,
      ...restDeviceEndpointIterables,
    )) {
    }
  }
}
