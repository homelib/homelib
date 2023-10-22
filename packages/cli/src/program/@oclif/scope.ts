import {resolve} from 'path';

import {Scope} from '@homelib/core';
import {Args, Flags} from '@oclif/core';

export const ScopeArg = Args.custom<Scope>({
  parse: parseScope,
});

export const ScopeFlag = Flags.custom<Scope>({
  parse: parseScope,
});

async function parseScope(path: string): Promise<Scope> {
  const {default: scope} = await import(resolve(path));

  if (!(scope instanceof Scope)) {
    throw new TypeError('Expected an instance of Scope.');
  }

  return scope;
}
