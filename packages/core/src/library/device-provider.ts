import type {DeviceEndpoint, UnknownDevice} from './device/index.js';

export abstract class DeviceProvider {
  abstract iterateEndpoints(): AsyncIterableIterator<DeviceEndpoint>;
}
