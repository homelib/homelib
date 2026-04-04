import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class Light extends Device<LightEndpoint> {
  readonly type = 'light';

  override connect(): LightEndpoint {
    throw new Error('Method not implemented.');
  }
}

export class LightEndpoint extends DeviceEndpoint {
  override dispose(): void {
    throw new Error('Method not implemented.');
  }

  set colorTemperature(value: number) {
    // Set color temperature logic here
  }
}

export const $light = $constructor(Light);
