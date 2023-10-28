import {types} from '@homelib/x';

import type {Scope as CoreScope} from '@homelib/core';

export class ScopeClass {
  declare [types]: {};
}

export type Scope<TScope extends CoreScope> = ScopeClass & {};
