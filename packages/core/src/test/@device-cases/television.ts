import {$constructor, Device, device_type, types} from '../../library/index.js';

export class Television extends Device {
  declare [device_type]: 'television';
}

export const $television = $constructor(Television);
