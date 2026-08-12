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
  type MiotEndpointConnectionResource,
  type MiotEndpointConnectionTransports,
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
    disposeConnection?: (
      connection: MiotEndpointConnection<never>,
    ) => void | PromiseLike<void>,
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

export type MiotEndpointProfile = {
  readonly device?: string | readonly string[];
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
      metadata: MiotEndpointConnectionMetadata,
      transports: MiotEndpointConnectionTransports,
    ): MiotEndpointConnection<TCommand> & TEndpointConnection;
    assertMetadata(metadata: MiotEndpointConnectionMetadata): void;
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

      for (const resources of resolveMiotEndpointProfileCandidates(
        spec,
        endpointProfiles,
      )) {
        const metadata = MiotEndpointConnectionMetadata.satisfies({
          device: {did: device.did, model: device.model, urn: spec.type},
          resources,
        });
        const key = getMetadataCandidateKey(type, metadata);

        if (candidateMap.has(key)) {
          continue;
        }

        Connection.assertMetadata(metadata);
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
    assertMetadata(metadata) {
      Connection.assertMetadata(metadata);
    },
    createBinding(provider, endpoint, metadata, transports, disposeConnection) {
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
        binding: createEndpointConnectionBinding(endpoint, connection, () =>
          disposeConnection?.(connection),
        ),
      };
    },
  };
}

export function getValidatedMiotEndpointProperties<
  TProperties extends Readonly<Record<string, MiotSpecProperty>>,
>(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  profiles: readonly MiotEndpointProfile[],
): TProperties {
  return Object.assign(
    {},
    ...getValidatedMiotEndpointResources(endpointType, metadata, profiles).map(
      resource => resource.properties,
    ),
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
    resourcesEqual(left.resources, right.resources)
  );
}

export function getValidatedMiotEndpointResources(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  profiles: readonly MiotEndpointProfile[],
): readonly MiotEndpointConnectionResource[] {
  const spec: MiotSpecInstance = {
    type: metadata.device.urn,
    description: metadata.device.model,
    services: metadata.resources.map(resource => resource.service),
  };
  for (const expectedResources of resolveMiotEndpointProfileCandidates(
    spec,
    profiles,
  )) {
    if (resourcesEqual(expectedResources, metadata.resources)) {
      return expectedResources;
    }
  }

  throw new TypeError(`Invalid MIoT ${endpointType} endpoint metadata.`);
}

function resolveMiotEndpointProfileCandidates(
  spec: MiotSpecInstance,
  profiles: readonly MiotEndpointProfile[],
): readonly (readonly MiotEndpointConnectionResource[])[] {
  const deviceProfiles = profiles.filter(
    profile =>
      profile.device !== undefined &&
      matchesMiotType(spec.type, profile.device),
  );
  const applicableProfiles =
    deviceProfiles.length === 0
      ? profiles.filter(profile => profile.device === undefined)
      : deviceProfiles;
  const candidates: MiotEndpointConnectionResource[][] = [];
  const claimedServiceIidSet = new Set<number>();

  for (const profile of applicableProfiles) {
    const profileCandidates = resolveMiotEndpointProfile(spec, profile).filter(
      resources =>
        resources.every(({service}) => !claimedServiceIidSet.has(service.iid)),
    );

    candidates.push(...profileCandidates);

    for (const resources of profileCandidates) {
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
): MiotEndpointConnectionResource[][] {
  const matchLists = profile.services.map(matcher =>
    findMiotEndpointMatches(spec, matcher),
  );

  if (matchLists.some(matches => matches.length === 0)) {
    return [];
  }

  const candidates: MiotEndpointConnectionResource[][] = [];
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

      const key = getResourceCombinationKey(resources);

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
  resources: readonly MiotEndpointConnectionResource[],
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

function matchesMiotType(
  actual: string,
  expected: string | readonly string[],
): boolean {
  if (typeof expected === 'string') {
    return actual === expected || actual.startsWith(`${expected}:`);
  }

  return expected.some(type => matchesMiotType(actual, type));
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

function getResourceCombinationKey(
  resources: readonly MiotEndpointConnectionResource[],
): string {
  return JSON.stringify(getResourceCombinationKeyValue(resources));
}

function getResourceCombinationKeyValue(
  resources: readonly MiotEndpointConnectionResource[],
): readonly unknown[] {
  return resources.toSorted(compareResources).map(resource => {
    const propertyKeys = Object.entries(resource.properties)
      .map(([name, property]) => [name, property.iid] as const)
      .sort(([left], [right]) => compareStrings(left, right));

    return [resource.service.iid, propertyKeys];
  });
}

function resourcesEqual(
  expected: readonly MiotEndpointConnectionResource[],
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
        serviceEqual(expectedResource.service, actualResource.service) &&
        propertiesEqual(expectedResource.properties, actualResource.properties)
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

function propertiesEqual<
  TProperties extends Record<string, MiotPropertyMatcher>,
  TOptionalProperties extends Record<string, MiotPropertyMatcher>,
>(
  expected: MiotEndpointMatch<TProperties, TOptionalProperties>['properties'],
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
