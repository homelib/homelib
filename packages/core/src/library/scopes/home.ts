import {$constructor} from '../utils/index.js';

import {Scope} from './scope.js';

export class Home extends Scope {
  constructor(name: string) {
    super(name, true);
  }
}

export const $home = $constructor(Home);
