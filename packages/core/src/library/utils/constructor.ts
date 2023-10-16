export function $constructor<
  TConstructor extends new (...args: never[]) => object,
>(
  Constructor: TConstructor,
): PreCallableConstructor<
  ConstructorParameters<TConstructor>,
  InstanceType<TConstructor>
>;
export function $constructor(
  Constructor: new (...args: unknown[]) => object,
): (...args: unknown[]) => object {
  const prototype = Constructor.prototype;

  const calls: [key: string | symbol, args: unknown[]][] = [];

  return new Proxy(
    (...args) => {
      const instance = new Constructor(...args);

      for (const [key, args] of calls) {
        const method = Reflect.get(instance, key);

        if (typeof method !== 'function') {
          throw new TypeError(`Expected ${String(key)} to be a function`);
        }

        method.apply(instance, args);
      }

      return instance;
    },
    {
      get(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(prototype, key);

        if (!descriptor || typeof descriptor.value !== 'function') {
          return Reflect.get(target, key);
        }

        return function (this: object, ...args: unknown[]) {
          calls.push([key, args]);
          return this;
        };
      },
    },
  );
}

type PreCallableConstructor<TArgs extends never[], T extends object> = ((
  ...args: TArgs
) => T) & {
  [TKey in PreCallableKey<T>]: (
    ...args: Parameters<Extract<T[TKey], (...args: never[]) => void>>
  ) => T & PreCallableConstructor<TArgs, T>;
};

type PreCallableKey<T extends object> = {
  [TKey in keyof T]: T[TKey] extends (...args: never[]) => void ? TKey : never;
}[keyof T];
