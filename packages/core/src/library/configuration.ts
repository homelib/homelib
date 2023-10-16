export type Configuration = {
  type: 'enum';
  values: string[];
};

export type Configurable = Record<string, Configuration>;

export function $configuration() {}
