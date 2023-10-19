export declare const types: '__types__';

export type types = typeof types;

export type NamedObject<TName extends string> = {
  [types]: {
    name: TName;
  };
};

export type UnknownNamedObject = NamedObject<string>;

export type NamedTupleToRecord<TTuple extends readonly UnknownNamedObject[]> = {
  // `TIndex in ... as ...` doesn't work here, adding `as` breaks tuple mapping
  //   behavior and results in something like {a: 'a' | 'b'} | {b: 'a' | 'b'}
  [TName in TTuple[number][types]['name']]: Extract<
    TTuple[number],
    NamedObject<TName>
  >;
};
