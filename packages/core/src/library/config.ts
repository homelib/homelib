export type ConfigDeclaration =
  | {
      type: 'switch';
    }
  | {
      type: 'mode';
      values: readonly string[];
    };

export type ConfigDeclarationsToConfigs<
  TDeclarations extends ConfigDeclarationsConstraint,
> = {
  [TKey in keyof TDeclarations]: ConfigDeclarationToConfig<TDeclarations[TKey]>;
};

export type ConfigDeclarationToConfig<TDeclaration extends ConfigDeclaration> =
  TDeclaration extends {type: 'switch'}
    ? boolean
    : TDeclaration extends {
        type: 'mode';
        values: infer TModeValues extends readonly string[];
      }
    ? TModeValues[number]
    : never;

export type ConfigDeclarationsConstraint = Record<string, ConfigDeclaration>;
