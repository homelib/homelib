import * as x from 'x-value';

import type {Device, DeviceConstructor} from './device.js';
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
    deviceConstructors: readonly DeviceConstructor<Device>[],
    metadata: unknown,
  ): EndpointConnectionBindingPlan<TMetadata> {
    const validatedMetadata =
      this.EndpointConnectionMetadata.satisfies(metadata);
    const plan = this.createEndpointConnectionBindingPlanFromMetadata(
      endpoint,
      deviceConstructors,
      validatedMetadata,
    );

    return {
      prepare: async () => {
        const preparedPlan = await plan.prepare();

        return {
          resourceKeys: preparedPlan.resourceKeys,
          persistedMetadata: this.EndpointConnectionMetadata.satisfies(
            preparedPlan.persistedMetadata,
          ),
          create: () => preparedPlan.create(),
        };
      },
    };
  }

  protected abstract createEndpointConnectionBindingPlanFromMetadata(
    endpoint: EndpointReference,
    deviceConstructors: readonly DeviceConstructor<Device>[],
    metadata: TMetadata,
  ): EndpointConnectionBindingPlan<TMetadata>;
}

export type EndpointConnectionBindingPlan<
  TMetadata extends EndpointConnectionMetadata = EndpointConnectionMetadata,
> = {
  /**
   * Resolves canonical metadata and resource claims without allocating runtime
   * resources. Preparation may populate durable caches, but it must be safe to
   * retry or discard its result.
   */
  prepare(): PromiseLike<PreparedEndpointConnectionBindingPlan<TMetadata>>;
};

export type PreparedEndpointConnectionBindingPlan<
  TMetadata extends EndpointConnectionMetadata = EndpointConnectionMetadata,
> = {
  readonly resourceKeys: readonly string[];
  readonly persistedMetadata: TMetadata;
  /** Allocates the runtime binding after every prepared plan is accepted. */
  create(): PromiseLike<EndpointConnectionBinding>;
};

export type RuntimeProvider = {
  readonly name: ProviderName;
  readonly endpointConnections: readonly EndpointConnection<never>[];
  createEndpointConnectionBindingPlan(
    endpoint: EndpointReference,
    deviceConstructors: readonly DeviceConstructor<Device>[],
    metadata: unknown,
  ): EndpointConnectionBindingPlan;
};
