import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class Switch extends Device<SwitchEndpoint> {
  readonly type = 'switch';
}

export class SwitchEndpoint extends DeviceEndpoint {
  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $switch = $constructor(Switch);
