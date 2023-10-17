import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Home extends Scope {
  declare foo: string;
}

export const $home = $constructor(Home);
