import type {Endpoint} from '@project-chip/matter.js/device';

import {Device, DeviceEndpoint} from './device/index.js';

export class UnlinkedDevice extends Device<UnlinkedDeviceEndpoint> {
  readonly type = '@homelib/core/unlinked-device';

  override connect(endpoint: Endpoint): UnlinkedDeviceEndpoint {
    return new UnlinkedDeviceEndpoint(endpoint);
  }
}

export class UnlinkedDeviceEndpoint extends DeviceEndpoint {
  override dispose(): void {}
}
