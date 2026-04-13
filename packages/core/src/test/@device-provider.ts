import {DeviceEndpoint, DeviceProvider} from '../library/index.js';

export class TestDeviceProvider extends DeviceProvider {
  constructor(readonly endpoints: (DeviceEndpoint | (() => Promise<void>))[]) {
    super();
  }

  override async *iterateEndpoints(): AsyncIterableIterator<DeviceEndpoint> {
    for (const endpoint of this.endpoints) {
      if (endpoint instanceof DeviceEndpoint) {
        yield endpoint;
      } else {
        await endpoint();
      }
    }
  }
}
