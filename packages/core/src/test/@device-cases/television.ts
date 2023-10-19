import {$constructor, Device} from '../../library/index.js';

export class Television extends Device<'television'> {}

export const $television = $constructor(Television);
