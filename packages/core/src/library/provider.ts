import * as x from 'x-value';

import type {Command} from './command.js';
import type {
  Endpoint,
  EndpointConnection,
  EndpointConnectionMetadata,
} from './endpoint.js';
import type {NamedObject, types} from './types.js';

export const ProviderName = x.string.nominal<'provider name'>();

export type ProviderName = x.TypeOf<typeof ProviderName>;

export abstract class Provider<
  TCommand extends Command,
  TMetadata extends EndpointConnectionMetadata = EndpointConnectionMetadata,
> implements NamedObject<ProviderName> {
  declare [types]: {name: ProviderName};

  readonly name: ProviderName;

  abstract readonly EndpointConnectionMetadata: x.XTypeOfValue<TMetadata>;

  constructor(name: string) {
    this.name = name as ProviderName;
  }

  abstract get endpointConnections(): readonly EndpointConnection<TCommand>[];

  abstract createEndpointConnection(
    endpoint: Endpoint<TCommand>,
    metadata: TMetadata,
  ): PromiseLike<EndpointConnection<TCommand>>;
}
