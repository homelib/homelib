import {$constructor, Device} from '@homelib/core';

export class Light extends Device<'@homelib/universal/light'> {}

export const $light = $constructor(Light);
