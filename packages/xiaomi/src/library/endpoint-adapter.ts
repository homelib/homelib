import {
  type Command,
  type Endpoint,
  type EndpointConnection,
  type EndpointConnectionBinding,
  type EndpointReference,
  createEndpointConnectionBinding,
} from '@homelib/core';

import {
  type MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionTransports,
  getMiotEndpointConnectionResourceKey,
} from './endpoint-connection.js';
import {
  type MiotEndpointMatch,
  type MiotEndpointMatcher,
  type MiotPropertyMatcher,
  type MiotSpecInstance,
  type MiotSpecProperty,
  findMiotEndpointMatches,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

export type MiotEndpointAdapter = {
  readonly type: string;
  readonly Endpoint: MiotEndpointConstructor;
  readonly findMetadataCandidates: (
    device: MiotEndpointAdapterDevice,
    spec: MiotSpecInstance,
  ) => readonly MiotEndpointMetadataCandidate[];
  readonly assertMetadata: (metadata: MiotEndpointConnectionMetadata) => void;
  readonly createBinding: (
    provider: MiotProvider,
    endpoint: EndpointReference,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) => MiotEndpointAdapterBinding;
};

export type MiotEndpointAdapterDevice = {
  readonly did: string;
  readonly model: string;
};

export type MiotEndpointMetadataCandidate = {
  readonly key: string;
  readonly label: string;
  readonly metadata: MiotEndpointConnectionMetadata;
};

export type MiotEndpointAdapterBinding = {
  readonly connection: MiotEndpointConnection<never>;
  readonly binding: EndpointConnectionBinding;
};

export class MiotEndpointAdapterRegistry {
  private readonly adapterMap = new Map<Function, MiotEndpointAdapter>();

  private readonly adapterTypeSet = new Set<string>();

  constructor(readonly adapters: readonly MiotEndpointAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapterMap.has(adapter.Endpoint)) {
        throw new TypeError('Duplicate MIoT endpoint adapter Endpoint.');
      } else if (this.adapterTypeSet.has(adapter.type)) {
        throw new TypeError(
          `Duplicate MIoT endpoint adapter: ${adapter.type}.`,
        );
      }

      this.adapterMap.set(adapter.Endpoint, adapter);
      this.adapterTypeSet.add(adapter.type);
    }
  }

  get(endpoint: EndpointReference): MiotEndpointAdapter | undefined {
    return this.adapterMap.get(endpoint.constructor);
  }
}

export function defineMiotEndpointAdapter<
  TCommand extends Command,
  TEndpointConnection extends EndpointConnection<TCommand>,
>(definition: {
  readonly type: string;
  readonly Endpoint: new (
    name?: string,
  ) => Endpoint<TCommand, TEndpointConnection>;
  readonly Connection: {
    new (
      provider: MiotProvider,
      metadata: MiotEndpointConnectionMetadata,
      transports: MiotEndpointConnectionTransports,
    ): MiotEndpointConnection<TCommand> & TEndpointConnection;
    assertMetadata(metadata: MiotEndpointConnectionMetadata): void;
  };
  readonly endpointMatchers: readonly MiotEndpointMatcher[];
}): MiotEndpointAdapter {
  const {
    type,
    Endpoint: EndpointConstructor,
    Connection,
    endpointMatchers,
  } = definition;

  return {
    type,
    Endpoint: EndpointConstructor,
    findMetadataCandidates(device, spec) {
      const resourceCandidateMap = new Map<
        string,
        MiotEndpointMetadataCandidate
      >();

      for (const matcher of endpointMatchers) {
        for (const match of findMiotEndpointMatches(spec, matcher)) {
          const metadata = MiotEndpointConnectionMetadata.satisfies({
            device: {did: device.did, model: device.model, urn: spec.type},
            service: match.service,
            properties: match.properties,
          });

          Connection.assertMetadata(metadata);

          const resourceKey = getMiotEndpointConnectionResourceKey(metadata);
          const candidate = {
            key: getMetadataCandidateKey(type, metadata),
            label: match.service.description,
            metadata,
          };
          const existingCandidate = resourceCandidateMap.get(resourceKey);

          if (existingCandidate === undefined) {
            resourceCandidateMap.set(resourceKey, candidate);
          } else if (
            getStableValueKey(existingCandidate.metadata) !==
            getStableValueKey(metadata)
          ) {
            throw new TypeError(
              `Ambiguous MIoT ${type} endpoint metadata for one service.`,
            );
          }
        }
      }

      return [...resourceCandidateMap.values()];
    },
    assertMetadata(metadata) {
      Connection.assertMetadata(metadata);
    },
    createBinding(provider, endpoint, metadata, transports) {
      if (
        !(endpoint instanceof EndpointConstructor) ||
        endpoint.constructor !== EndpointConstructor
      ) {
        throw new TypeError('Endpoint does not match its MIoT adapter.');
      }

      Connection.assertMetadata(metadata);

      const connection = new Connection(provider, metadata, transports);

      return {
        connection,
        binding: createEndpointConnectionBinding(endpoint, connection),
      };
    },
  };
}

export function getValidatedMiotEndpointProperties<
  TProperties extends Record<string, MiotPropertyMatcher>,
>(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  matchers: readonly MiotEndpointMatcher<TProperties>[],
): MiotEndpointMatch<TProperties>['properties'] {
  const spec: MiotSpecInstance = {
    type: metadata.device.urn,
    description: metadata.device.model,
    services: [metadata.service],
  };

  for (const matcher of matchers) {
    for (const match of findMiotEndpointMatches(spec, matcher)) {
      if (
        match.service.iid === metadata.service.iid &&
        propertiesEqual(match.properties, metadata.properties)
      ) {
        return match.properties;
      }
    }
  }

  throw new TypeError(`Invalid MIoT ${endpointType} endpoint metadata.`);
}

type MiotEndpointConstructor = abstract new (
  name?: string,
) => EndpointReference;

function getMetadataCandidateKey(
  adapterType: string,
  metadata: MiotEndpointConnectionMetadata,
): string {
  const propertyKeys = Object.entries(metadata.properties)
    .map(([name, property]) => [name, property.iid] as const)
    .sort(([left], [right]) => compareStrings(left, right));

  return JSON.stringify([
    adapterType,
    metadata.device.did,
    metadata.service.iid,
    propertyKeys,
  ]);
}

function getStableValueKey(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item));
  } else if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }

  return value;
}

function propertiesEqual<
  TProperties extends Record<string, MiotPropertyMatcher>,
>(
  expected: MiotEndpointMatch<TProperties>['properties'],
  actual: Readonly<Record<string, MiotSpecProperty>>,
): boolean {
  const expectedNames = Object.keys(expected);
  const actualNames = Object.keys(actual);

  if (!uniqueStringArraysEqual(expectedNames, actualNames)) {
    return false;
  }

  return expectedNames.every(name => {
    const expectedProperty = expected[name];
    const actualProperty = actual[name];

    return (
      expectedProperty !== undefined &&
      actualProperty !== undefined &&
      propertyEqual(expectedProperty, actualProperty)
    );
  });
}

function propertyEqual(
  left: MiotSpecProperty,
  right: MiotSpecProperty,
): boolean {
  return (
    left.iid === right.iid &&
    left.type === right.type &&
    left.format === right.format &&
    uniqueStringArraysEqual(left.access, right.access)
  );
}

function uniqueStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    leftSet.isSubsetOf(rightSet)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  }

  return 0;
}
