import {$constructor, Device} from '../../library/index.js';

export class Light extends Device<'light'> {}

export const $light = $constructor(Light);
