import * as x from 'x-value';

import type {Command} from './command.js';
import type {EndpointConnection} from './endpoint.js';
import type {NamedObject, types} from './types.js';

export const ProviderName = x.string.nominal<'provider name'>();

export type ProviderName = x.TypeOf<typeof ProviderName>;

export abstract class Provider<
  TCommand extends Command,
> implements NamedObject<ProviderName> {
  declare [types]: {name: ProviderName};

  readonly name: ProviderName;

  constructor(name: string) {
    this.name = name as ProviderName;
  }

  abstract get endpointConnections(): EndpointConnection<TCommand>[];
}
