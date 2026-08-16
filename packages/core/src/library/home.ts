import {assertDeclaring} from './@lifecycle.js';
import {getRootScopes, registerRootScope} from './registry.js';
import {
  type MaterializedScopeDeclaration,
  type ScopeDeclarationBuilder,
  type ScopeDeclarationBuilderChildren,
  type ScopeDeclarationChildren,
  createScopeDeclaration,
  materializeScopeDeclaration,
} from './scope-declaration.js';
import {Scope} from './scope.js';
import type {NamedObject} from './types.js';
import {$constructor} from './utils/index.js';

export class Home extends Scope {}

const createHome = $constructor(Home).build(home => {
  registerRootScope(home);
});

export type DeclaredHome<
  TName extends string,
  TChildren extends ScopeDeclarationChildren,
> = Home & NamedObject<TName> & MaterializedScopeDeclaration<TChildren>;

type HomeScopeDeclarationOwner<TName extends string> = {
  readonly home: TName;
};

type HomeConstructor = {
  <
    const TName extends string,
    TBuilder extends ScopeDeclarationBuilder<
      ScopeDeclarationChildren,
      HomeScopeDeclarationOwner<TName>
    >,
  >(
    name: TName,
    declare: (
      home: ScopeDeclarationBuilder<{}, HomeScopeDeclarationOwner<TName>>,
    ) => TBuilder,
  ): DeclaredHome<TName, ScopeDeclarationBuilderChildren<TBuilder>>;
} & typeof createHome;

const homeConstructor = (
  name: string,
  parentOrDeclare?:
    | Scope
    | ((
        home: ScopeDeclarationBuilder<{}, unknown>,
      ) => ScopeDeclarationBuilder<ScopeDeclarationChildren, unknown>),
): Home => {
  if (typeof parentOrDeclare !== 'function') {
    return createHome(name, parentOrDeclare);
  }

  assertDeclaring();
  assertHomeNameAvailable(name);
  const declaration = createScopeDeclaration(parentOrDeclare);
  assertHomeNameAvailable(name);
  const home = new Home(name);

  materializeScopeDeclaration(home, declaration);
  registerRootScope(home);

  return home;
};

Object.setPrototypeOf(homeConstructor, Object.getPrototypeOf(createHome));

export const $home = homeConstructor as HomeConstructor;

function assertHomeNameAvailable(name: string): void {
  if ([...getRootScopes()].some(scope => scope.name === name)) {
    throw new TypeError(`Duplicate home: ${name}.`);
  }
}
