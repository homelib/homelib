import {Device, DeviceEndpoint} from './device/index.js';

export class UnlinkedDevice extends Device<UnlinkedDeviceEndpoint> {
  readonly type = '@homelib/core/unlinked-device';
}

export class UnlinkedDeviceEndpoint extends DeviceEndpoint {
  override dispose(): void {}
}
