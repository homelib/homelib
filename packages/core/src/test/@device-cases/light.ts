import {$constructor, Device, device_type, types} from '../../library/index.js';

export class Light extends Device {
  declare [device_type]: 'light';
}

export const $light = $constructor(Light);
