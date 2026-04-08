import type {DeviceEndpoint, UnknownDevice} from '../../library/index.js';
import {DeviceProvider} from '../../library/index.js';

export class DummyDeviceProvider extends DeviceProvider {
  override async *iterateEndpoints(): AsyncIterableIterator<DeviceEndpoint> {}
}
