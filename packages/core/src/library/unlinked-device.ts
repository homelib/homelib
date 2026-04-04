import {Device, DeviceEndpoint} from './device/index.js';

export class UnlinkedDevice extends Device<UnlinkedDeviceEndpoint> {
  readonly type = '@homelib/core/unlinked-device';

  override connect(): UnlinkedDeviceEndpoint {
    return new UnlinkedDeviceEndpoint();
  }
}

export class UnlinkedDeviceEndpoint extends DeviceEndpoint {
  override dispose(): void {}
}
