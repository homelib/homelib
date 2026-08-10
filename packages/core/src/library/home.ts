import {registerRootScope} from './registry.js';
import {Scope} from './scope.js';
import {$constructor, uniqueName} from './utils/index.js';

export class Home extends Scope {}

export const $home = $constructor(Home)
  .build(uniqueName('home'))
  .build(home => {
    registerRootScope(home);
  });
