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
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionResolvedResource,
  type MiotEndpointConnectionResource,
  type MiotEndpointConnectionTransports,
  createMiotEndpointConnectionResolvedMetadata,
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
  readonly resolveMetadata: (
    metadata: MiotEndpointConnectionMetadata,
  ) => MiotEndpointConnectionResolvedMetadata;
  readonly createBinding: (
    provider: MiotProvider,
    endpoint: EndpointReference,
    metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
    disposeConnection?: (
      connection: MiotEndpointConnection<never>,
    ) => void | PromiseLike<void>,
  ) => MiotEndpointAdapterBinding;
};

export type MiotEndpointAdapterDevice = {
  readonly did: string;
  readonly model?: string;
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

export type MiotEndpointProfile = {
  /** Required peer services. Their order has no matching or ownership meaning. */
  readonly services: readonly [
    MiotEndpointServiceMatcher,
    ...MiotEndpointServiceMatcher[],
  ];
};

export type MiotEndpointServiceMatcher = Omit<MiotEndpointMatcher, 'device'>;

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
      metadata: MiotEndpointConnectionResolvedMetadata,
      transports: MiotEndpointConnectionTransports,
    ): MiotEndpointConnection<TCommand> & TEndpointConnection;
  };
  readonly endpointProfiles: readonly MiotEndpointProfile[];
}): MiotEndpointAdapter {
  const {
    type,
    Endpoint: EndpointConstructor,
    Connection,
    endpointProfiles,
  } = definition;

  return {
    type,
    Endpoint: EndpointConstructor,
    findMetadataCandidates(device, spec) {
      const candidateMap = new Map<string, MiotEndpointMetadataCandidate>();
      const resolvedResourceMap = new Map<
        string,
        readonly MiotEndpointConnectionResolvedResource[]
      >();
      const ambiguousKeySet = new Set<string>();

      for (const resources of resolveMiotEndpointProfileCandidates(
        spec,
        endpointProfiles,
      )) {
        const metadata = MiotEndpointConnectionMetadata.satisfies({
          device: {did: device.did, model: device.model, urn: spec.type},
          resources: resources.map(({service}) => ({service})),
        });
        const key = getMetadataCandidateKey(type, metadata);

        const existingResources = resolvedResourceMap.get(key);

        if (existingResources !== undefined) {
          if (!resolvedResourcesEqual(existingResources, resources)) {
            candidateMap.delete(key);
            resolvedResourceMap.delete(key);
            ambiguousKeySet.add(key);
          }

          continue;
        }

        if (ambiguousKeySet.has(key)) {
          continue;
        }

        resolvedResourceMap.set(key, resources);
        candidateMap.set(key, {
          key,
          label: metadata.resources
            .map(({service}) => service.description)
            .join(' + '),
          metadata,
        });
      }

      return [...candidateMap.values()];
    },
    resolveMetadata(metadata) {
      return resolveMiotEndpointConnectionMetadata(
        type,
        metadata,
        endpointProfiles,
      );
    },
    createBinding(provider, endpoint, metadata, transports, disposeConnection) {
      if (
        !(endpoint instanceof EndpointConstructor) ||
        endpoint.constructor !== EndpointConstructor
      ) {
        throw new TypeError('Endpoint does not match its MIoT adapter.');
      }

      const connection = new Connection(provider, metadata, transports);

      return {
        connection,
        binding: createEndpointConnectionBinding(endpoint, connection, () =>
          disposeConnection?.(connection),
        ),
      };
    },
  };
}

export function getMiotEndpointConnectionProperties<
  TProperties extends Readonly<Record<string, MiotSpecProperty>>,
>(metadata: MiotEndpointConnectionResolvedMetadata): TProperties {
  return Object.assign(
    {},
    ...metadata.resources.map(resource => resource.properties),
  ) as TProperties;
}

export function miotEndpointConnectionMetadataEqual(
  left: MiotEndpointConnectionMetadata,
  right: MiotEndpointConnectionMetadata,
): boolean {
  return (
    left.device.did === right.device.did &&
    left.device.model === right.device.model &&
    left.device.urn === right.device.urn &&
    physicalResourcesEqual(left.resources, right.resources)
  );
}

export function resolveMiotEndpointConnectionMetadata(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  profiles: readonly MiotEndpointProfile[],
): MiotEndpointConnectionResolvedMetadata {
  const spec: MiotSpecInstance = {
    type: metadata.device.urn,
    description: metadata.device.model ?? metadata.device.urn,
    services: metadata.resources.map(resource => resource.service),
  };
  const matchedResources = resolveMiotEndpointProfileCandidates(
    spec,
    profiles,
  ).filter(resources =>
    resolvedResourcesMatchMetadata(resources, metadata.resources),
  );
  const uniqueResources: Array<
    readonly MiotEndpointConnectionResolvedResource[]
  > = [];

  for (const resources of matchedResources) {
    if (
      !uniqueResources.some(existing =>
        resolvedResourcesEqual(existing, resources),
      )
    ) {
      uniqueResources.push(resources);
    }
  }

  const [resources] = uniqueResources;

  if (resources === undefined || uniqueResources.length !== 1) {
    throw new TypeError(`Invalid MIoT ${endpointType} endpoint metadata.`);
  }

  return createMiotEndpointConnectionResolvedMetadata(metadata, resources);
}

function resolveMiotEndpointProfileCandidates(
  spec: MiotSpecInstance,
  profiles: readonly MiotEndpointProfile[],
): readonly (readonly MiotEndpointConnectionResolvedResource[])[] {
  const candidates: MiotEndpointConnectionResolvedResource[][] = [];
  const claimedServiceIidSet = new Set<number>();
  const candidateKeySet = new Set<string>();

  for (const profile of profiles) {
    const profileCandidates = resolveMiotEndpointProfile(spec, profile).filter(
      resources => {
        const key = getPhysicalResourceCombinationKey(resources);

        // A physical binding cannot persist which of two semantic mappings
        // was selected. Preserve same-address results so the caller can reject
        // conflicting mappings instead of silently relying on profile order.
        return (
          candidateKeySet.has(key) ||
          resources.every(({service}) => !claimedServiceIidSet.has(service.iid))
        );
      },
    );

    candidates.push(...profileCandidates);

    for (const resources of profileCandidates) {
      candidateKeySet.add(getPhysicalResourceCombinationKey(resources));

      for (const {service} of resources) {
        claimedServiceIidSet.add(service.iid);
      }
    }
  }

  return candidates;
}

function resolveMiotEndpointProfile(
  spec: MiotSpecInstance,
  profile: MiotEndpointProfile,
): MiotEndpointConnectionResolvedResource[][] {
  const matchLists = profile.services.map(matcher =>
    findMiotEndpointMatches(spec, matcher),
  );

  if (matchLists.some(matches => matches.length === 0)) {
    return [];
  }

  const candidates: MiotEndpointConnectionResolvedResource[][] = [];
  const candidateKeySet = new Set<string>();

  const visit = (
    index: number,
    matches: MiotEndpointMatch<Record<string, MiotPropertyMatcher>>[],
    serviceIidSet: Set<number>,
  ): void => {
    const matchList = matchLists[index];

    if (matchList === undefined) {
      const resources = matches
        .map(({service, properties}) => ({service, properties}))
        .sort((left, right) => left.service.iid - right.service.iid);

      if (!hasUniqueMiotEndpointAliases(resources)) {
        return;
      }

      const key = getResolvedResourceCombinationKey(resources);

      if (!candidateKeySet.has(key)) {
        candidateKeySet.add(key);
        candidates.push(resources);
      }

      return;
    }

    for (const match of matchList) {
      if (serviceIidSet.has(match.service.iid)) {
        continue;
      }

      serviceIidSet.add(match.service.iid);
      matches.push(match);
      visit(index + 1, matches, serviceIidSet);
      matches.pop();
      serviceIidSet.delete(match.service.iid);
    }
  };

  visit(0, [], new Set());
  return candidates;
}

function hasUniqueMiotEndpointAliases(
  resources: readonly MiotEndpointConnectionResolvedResource[],
): boolean {
  const aliasSet = new Set<string>();

  for (const {properties} of resources) {
    for (const alias of Object.keys(properties)) {
      if (aliasSet.has(alias)) {
        return false;
      }

      aliasSet.add(alias);
    }
  }

  return true;
}

type MiotEndpointConstructor = abstract new (
  name?: string,
) => EndpointReference;

function getMetadataCandidateKey(
  adapterType: string,
  metadata: MiotEndpointConnectionMetadata,
): string {
  return JSON.stringify([
    adapterType,
    metadata.device.did,
    ...getResourceCombinationKeyValue(metadata.resources),
  ]);
}

function getResolvedResourceCombinationKey(
  resources: readonly MiotEndpointConnectionResolvedResource[],
): string {
  return JSON.stringify(
    resources.toSorted(compareResources).map(resource => {
      const propertyKeys = Object.entries(resource.properties)
        .map(([name, property]) => [name, property.iid] as const)
        .toSorted(([left], [right]) => compareStrings(left, right));

      return [resource.service.iid, propertyKeys];
    }),
  );
}

function getPhysicalResourceCombinationKey(
  resources: readonly MiotEndpointConnectionResource[],
): string {
  return JSON.stringify(getResourceCombinationKeyValue(resources));
}

function getResourceCombinationKeyValue(
  resources: readonly MiotEndpointConnectionResource[],
): readonly unknown[] {
  return resources
    .toSorted(compareResources)
    .map(resource => resource.service.iid);
}

function resolvedResourcesMatchMetadata(
  expected: readonly MiotEndpointConnectionResolvedResource[],
  actual: readonly MiotEndpointConnectionResource[],
): boolean {
  const actualResourceMap = new Map(
    actual.map(resource => [resource.service.iid, resource]),
  );

  return (
    expected.length === actual.length &&
    expected.every(expectedResource => {
      const actualResource = actualResourceMap.get(
        expectedResource.service.iid,
      );

      return (
        actualResource !== undefined &&
        serviceEqual(expectedResource.service, actualResource.service)
      );
    })
  );
}

function physicalResourcesEqual(
  left: readonly MiotEndpointConnectionResource[],
  right: readonly MiotEndpointConnectionResource[],
): boolean {
  return unorderedArraysEqual(left, right, (leftResource, rightResource) =>
    serviceEqual(leftResource.service, rightResource.service),
  );
}

function resolvedResourcesEqual(
  left: readonly MiotEndpointConnectionResolvedResource[],
  right: readonly MiotEndpointConnectionResolvedResource[],
): boolean {
  return unorderedArraysEqual(left, right, (leftResource, rightResource) => {
    return (
      serviceEqual(leftResource.service, rightResource.service) &&
      resolvedPropertiesEqual(leftResource.properties, rightResource.properties)
    );
  });
}

function resolvedPropertiesEqual(
  left: Readonly<Record<string, MiotSpecProperty>>,
  right: Readonly<Record<string, MiotSpecProperty>>,
): boolean {
  const leftNames = Object.keys(left);
  const rightNames = Object.keys(right);

  return (
    uniqueStringArraysEqual(leftNames, rightNames) &&
    leftNames.every(name => {
      const leftProperty = left[name];
      const rightProperty = right[name];

      return (
        leftProperty !== undefined &&
        rightProperty !== undefined &&
        propertyEqual(leftProperty, rightProperty)
      );
    })
  );
}

function compareResources(
  left: MiotEndpointConnectionResource,
  right: MiotEndpointConnectionResource,
): number {
  return left.service.iid - right.service.iid;
}

function serviceEqual(
  expected: MiotEndpointConnectionResource['service'],
  actual: MiotEndpointConnectionResource['service'],
): boolean {
  return (
    expected.iid === actual.iid &&
    expected.type === actual.type &&
    expected.description === actual.description &&
    optionalPropertyArraysEqual(expected.properties, actual.properties)
  );
}

function propertyEqual(
  left: MiotSpecProperty,
  right: MiotSpecProperty,
): boolean {
  return (
    left.iid === right.iid &&
    left.type === right.type &&
    left.description === right.description &&
    left.format === right.format &&
    left.unit === right.unit &&
    valueRangesEqual(left['value-range'], right['value-range']) &&
    valueListsEqual(left['value-list'], right['value-list']) &&
    uniqueStringArraysEqual(left.access, right.access)
  );
}

function optionalPropertyArraysEqual(
  left: readonly MiotSpecProperty[] | undefined,
  right: readonly MiotSpecProperty[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return unorderedArraysEqual(left, right, propertyEqual);
}

function valueRangesEqual(
  left: MiotSpecProperty['value-range'],
  right: MiotSpecProperty['value-range'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.every((value, index) => value === right[index]);
}

function valueListsEqual(
  left: MiotSpecProperty['value-list'],
  right: MiotSpecProperty['value-list'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return unorderedArraysEqual(left, right, (first, second) => {
    return (
      first.value === second.value && first.description === second.description
    );
  });
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
    [...leftSet].every(value => rightSet.has(value))
  );
}

function unorderedArraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  valuesEqual: (left: T, right: T) => boolean,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const matchedIndexSet = new Set<number>();

  for (const leftValue of left) {
    const matchedIndex = right.findIndex((rightValue, index) => {
      return !matchedIndexSet.has(index) && valuesEqual(leftValue, rightValue);
    });

    if (matchedIndex === -1) {
      return false;
    }

    matchedIndexSet.add(matchedIndex);
  }

  return true;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  }

  return 0;
}
