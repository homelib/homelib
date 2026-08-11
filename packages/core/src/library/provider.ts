import * as x from 'x-value';

import type {
  EndpointConnection,
  EndpointConnectionBinding,
  EndpointConnectionMetadata,
  EndpointReference,
} from './endpoint.js';
import type {NamedObject, types} from './types.js';

export const ProviderName = x.string.nominal<'provider name'>();

export type ProviderName = x.TypeOf<typeof ProviderName>;

export abstract class Provider<
  TMetadata extends EndpointConnectionMetadata = EndpointConnectionMetadata,
> implements NamedObject<ProviderName> {
  declare [types]: {name: ProviderName};

  readonly name: ProviderName;

  abstract readonly EndpointConnectionMetadata: x.XTypeOfValue<TMetadata>;

  constructor(name: string) {
    this.name = name as ProviderName;
  }

  abstract get endpointConnections(): readonly EndpointConnection<never>[];

  createEndpointConnectionBindingPlan(
    endpoint: EndpointReference,
    metadata: unknown,
  ): EndpointConnectionBindingPlan {
    const validatedMetadata =
      this.EndpointConnectionMetadata.satisfies(metadata);

    return this.createEndpointConnectionBindingPlanFromMetadata(
      endpoint,
      validatedMetadata,
    );
  }

  protected abstract createEndpointConnectionBindingPlanFromMetadata(
    endpoint: EndpointReference,
    metadata: TMetadata,
  ): EndpointConnectionBindingPlan;
}

export type EndpointConnectionBindingPlan = {
  readonly resourceKeys: readonly string[];
  create(): PromiseLike<EndpointConnectionBinding>;
};

export type RuntimeProvider = {
  readonly name: ProviderName;
  readonly endpointConnections: readonly EndpointConnection<never>[];
  createEndpointConnectionBindingPlan(
    endpoint: EndpointReference,
    metadata: unknown,
  ): EndpointConnectionBindingPlan;
};
