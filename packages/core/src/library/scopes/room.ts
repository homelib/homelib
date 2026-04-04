import {Scope} from '../scope.js';
import {$constructor} from '../utils/index.js';

export class Room extends Scope {}

export const $room = $constructor(Room);
