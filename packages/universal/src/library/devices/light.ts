import {$constructor, Device, device_type} from '@homelib/core';

export class Light extends Device {
  declare [device_type]: '@homelib/universal/light';
}

export const $light = $constructor(Light);
