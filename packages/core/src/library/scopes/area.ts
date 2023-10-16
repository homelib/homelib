import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Area extends Scope {}

export const $area = $constructor(Area);
