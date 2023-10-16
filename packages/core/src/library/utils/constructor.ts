export function $constructor<
  TConstructor extends new (...args: never[]) => object,
>(
  Constructor: TConstructor,
): ExtendedConstructor<
  ConstructorParameters<TConstructor>,
  InstanceType<TConstructor>
>;
export function $constructor(
  Constructor: new (...args: unknown[]) => object,
): (...args: unknown[]) => object {
  return build([]);

  function build(
    builders: ((instance: object) => object | void)[],
  ): (...args: unknown[]) => object {
    const built = (...args: unknown[]): object => {
      let instance = new Constructor(...args);

      for (const builder of builders) {
        instance = builder(instance) ?? instance;
      }

      return instance;
    };

    Reflect.setPrototypeOf(built, {
      build(builder: (instance: object) => object | void) {
        return build([...builders, builder]);
      },
    });

    return built;
  }
}

export type ExtendedConstructor<TArgs extends unknown[], T extends object> = {
  (...args: TArgs): T;
  build<TRefined extends object>(
    builder: (instance: T) => TRefined,
  ): ExtendedConstructor<TArgs, TRefined>;
  build(builder: (instance: T) => void): ExtendedConstructor<TArgs, T>;
};
