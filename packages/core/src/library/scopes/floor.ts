import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Floor extends Scope {}

export const $floor = $constructor(Floor);
