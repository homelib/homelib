import type {Scope} from '../scope.js';

const ROOT_SCOPE_SET = new Set<Scope>();

export function registerRootScope(scope: Scope): void {
  ROOT_SCOPE_SET.add(scope);
}

export function getRootScopes(): IterableIterator<Scope> {
  return ROOT_SCOPE_SET.values();
}
