import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

import type {Switch} from './switch.js';

export class Light extends Device<LightEndpoint> {
  readonly type = 'light';

  switches<TSwitches extends Switch[]>(
    switches: TSwitches,
  ): [this, ...TSwitches] {
    return [this, ...switches];
  }
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
