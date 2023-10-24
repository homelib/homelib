import {Scope} from '../scope.js';
import {$constructor} from '../utils/index.js';

export class Floor extends Scope {}

export const $floor = $constructor(Floor);
