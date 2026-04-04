export type ConfigDeclaration =
  | {
      type: 'switch';
    }
  | {
      type: 'mode';
      values: readonly string[];
    }
  | {
      type: 'text';
    };

export type ConfigDeclarationsToConfigs<
  TDeclarations extends UnknownConfigDeclarations,
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
      : TDeclaration extends {type: 'text'}
        ? string
        : never;

export type UnknownConfigDeclarations = Record<string, ConfigDeclaration>;
