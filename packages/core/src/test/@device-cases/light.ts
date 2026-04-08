import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class Light extends Device<LightEndpoint> {
  readonly type = 'light';
}

export class LightEndpoint extends DeviceEndpoint {
  set colorTemperature(value: number) {
    // Set color temperature logic here
  }

  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $light = $constructor(Light);
