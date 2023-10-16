import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Room extends Scope {}

export const $room = $constructor(Room);
