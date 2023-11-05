import type {x} from '@homelib/x';

export type IDefinition = {
  path: string;
  request: x.XTypeOfValue<object>;
  response: x.XTypeOfValue<object>;
};

export type RequestOf<TDefinition extends IDefinition> = x.TypeOf<
  TDefinition['request']
>;

export type ResponseOf<TDefinition extends IDefinition> = x.TypeOf<
  TDefinition['response']
>;
