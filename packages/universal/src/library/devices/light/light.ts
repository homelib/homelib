import {$constructor, Device} from '@homelib/core';

export class Light extends Device {
  readonly type = '@homelib/universal/light';
}

export const $light = $constructor(Light);
