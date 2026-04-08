import type {DeviceId} from '../x/index.js';

export abstract class DeviceEndpoint {
  constructor(readonly id: DeviceId) {}

  abstract dispose(): Promise<void> | void;
}
