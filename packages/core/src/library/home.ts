import {registerRootScope} from './runtime/index.js';
import {Scope} from './scope.js';
import {$constructor} from './utils/index.js';

export class Home extends Scope {}

export const $home = $constructor(Home).build(home => {
  registerRootScope(home);
});
