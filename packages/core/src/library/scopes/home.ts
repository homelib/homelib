import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Home extends Scope {}

export const $home = $constructor(Home);
