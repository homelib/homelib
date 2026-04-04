import {$constructor, Device} from '../../library/index.js';

export class Light extends Device {
  readonly type = 'light';
}

export const $light = $constructor(Light);
