import {$constructor, Device} from '../../library/index.js';

export class Television extends Device {
  readonly type = 'television';
}

export const $television = $constructor(Television);
