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
  getMiotEndpointConnectionResourceKey,
  getPrimaryMiotEndpointConnectionResource,
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

export type MiotEndpointProfile = {
  readonly primary: MiotEndpointMatcher;
  readonly supplements?: readonly MiotEndpointProfileSupplement[];
};

export type MiotEndpointProfileSupplement = {
  readonly matcher: MiotEndpointMatcher;
  readonly required?: boolean;
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
  readonly endpointMatchers?: readonly MiotEndpointMatcher[];
  readonly endpointProfiles?: readonly MiotEndpointProfile[];
}): MiotEndpointAdapter {
  const {
    type,
    Endpoint: EndpointConstructor,
    Connection,
    endpointMatchers,
    endpointProfiles,
  } = definition;
  const profiles = getMiotEndpointProfiles(endpointMatchers, endpointProfiles);

  return {
    type,
    Endpoint: EndpointConstructor,
    findMetadataCandidates(device, spec) {
      const resourceCandidateMap = new Map<
        string,
        MiotEndpointMetadataCandidate
      >();
      const claimedPrimaryServiceIidSet = new Set<number>();

      for (const profile of profiles) {
        for (const match of findMiotEndpointMatches(spec, profile.primary)) {
          if (claimedPrimaryServiceIidSet.has(match.service.iid)) {
            continue;
          }

          claimedPrimaryServiceIidSet.add(match.service.iid);
          const supplementResources = findMiotSupplementResources(
            spec,
            match.service.iid,
            profile.supplements,
          );

          if (supplementResources === undefined) {
            continue;
          }

          const metadata = MiotEndpointConnectionMetadata.satisfies({
            device: {did: device.did, model: device.model, urn: spec.type},
            resources: [
              {
                service: match.service,
                properties: match.properties,
                exclusive: true,
              },
              ...supplementResources,
            ],
          });
          const resourceKey = getMiotEndpointConnectionResourceKey(metadata);

          if (resourceCandidateMap.has(resourceKey)) {
            continue;
          }

          Connection.assertMetadata(metadata);
          const candidate = {
            key: getMetadataCandidateKey(type, metadata),
            label: match.service.description,
            metadata,
          };

          resourceCandidateMap.set(resourceKey, candidate);
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
  TOptionalProperties extends Record<string, MiotPropertyMatcher> = {},
>(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  matchers: readonly MiotEndpointMatcher<TProperties, TOptionalProperties>[],
): MiotEndpointMatch<TProperties, TOptionalProperties>['properties'] {
  return getValidatedMiotEndpointResources(endpointType, metadata, matchers)[0]
    .properties as MiotEndpointMatch<
    TProperties,
    TOptionalProperties
  >['properties'];
}

export function getValidatedMiotEndpointResources(
  endpointType: string,
  metadata: MiotEndpointConnectionMetadata,
  profilesOrMatchers:
    readonly MiotEndpointProfile[] | readonly MiotEndpointMatcher[],
): readonly MiotEndpointConnectionResource[] {
  const spec: MiotSpecInstance = {
    type: metadata.device.urn,
    description: metadata.device.model,
    services: metadata.resources.map(resource => resource.service),
  };
  const primaryResource = getPrimaryMiotEndpointConnectionResource(metadata);
  const profiles = normalizeMiotEndpointProfiles(profilesOrMatchers);

  for (const profile of profiles) {
    const primaryMatch = findMiotEndpointMatches(spec, profile.primary).find(
      candidate => {
        return candidate.service.iid === primaryResource.service.iid;
      },
    );

    if (primaryMatch === undefined) {
      continue;
    } else if (
      !propertiesEqual(primaryMatch.properties, primaryResource.properties)
    ) {
      break;
    }

    const expectedResources: MiotEndpointConnectionResource[] = [
      {
        service: primaryMatch.service,
        properties: primaryMatch.properties,
        exclusive: true,
      },
    ];
    let profileApplies = true;

    for (const supplement of profile.supplements ?? []) {
      const matches = findMiotEndpointMatches(spec, supplement.matcher).filter(
        match => match.service.iid !== primaryMatch.service.iid,
      );

      if (matches.length === 0) {
        if (supplement.required) {
          profileApplies = false;
          break;
        }

        continue;
      } else if (matches.length !== 1) {
        profileApplies = false;
        break;
      }

      const [match] = matches;

      if (match === undefined) {
        throw new TypeError('Missing MIoT endpoint supplement match.');
      }

      expectedResources.push({
        service: match.service,
        properties: match.properties,
        exclusive: false,
      });
    }

    if (!profileApplies) {
      break;
    } else if (!resourcesEqual(expectedResources, metadata.resources)) {
      break;
    }

    return expectedResources;
  }

  throw new TypeError(`Invalid MIoT ${endpointType} endpoint metadata.`);
}

function getMiotEndpointProfiles(
  endpointMatchers: readonly MiotEndpointMatcher[] | undefined,
  endpointProfiles: readonly MiotEndpointProfile[] | undefined,
): readonly MiotEndpointProfile[] {
  if (endpointProfiles !== undefined && endpointMatchers === undefined) {
    return endpointProfiles;
  } else if (endpointMatchers !== undefined && endpointProfiles === undefined) {
    return endpointMatchers.map(primary => ({primary}));
  }

  throw new TypeError(
    'MIoT endpoint adapter requires either matchers or profiles.',
  );
}

function normalizeMiotEndpointProfiles(
  profilesOrMatchers:
    readonly MiotEndpointProfile[] | readonly MiotEndpointMatcher[],
): readonly MiotEndpointProfile[] {
  return profilesOrMatchers.map(profileOrMatcher => {
    if ('primary' in profileOrMatcher) {
      return profileOrMatcher;
    }

    return {primary: profileOrMatcher};
  });
}

function findMiotSupplementResources(
  spec: MiotSpecInstance,
  primaryServiceIid: number,
  supplements: readonly MiotEndpointProfileSupplement[] | undefined,
): readonly MiotEndpointConnectionResource[] | undefined {
  const resources: MiotEndpointConnectionResource[] = [];

  for (const supplement of supplements ?? []) {
    const matches = findMiotEndpointMatches(spec, supplement.matcher).filter(
      match => match.service.iid !== primaryServiceIid,
    );

    if (matches.length === 0) {
      if (supplement.required) {
        return undefined;
      }

      continue;
    } else if (matches.length !== 1) {
      return undefined;
    }

    const [match] = matches;

    if (match === undefined) {
      throw new TypeError('Missing MIoT endpoint supplement match.');
    }

    resources.push({
      service: match.service,
      properties: match.properties,
      exclusive: false,
    });
  }

  return resources;
}

type MiotEndpointConstructor = abstract new (
  name?: string,
) => EndpointReference;

function getMetadataCandidateKey(
  adapterType: string,
  metadata: MiotEndpointConnectionMetadata,
): string {
  const resourceKeys = metadata.resources.map(resource => {
    const propertyKeys = Object.entries(resource.properties)
      .map(([name, property]) => [name, property.iid] as const)
      .sort(([left], [right]) => compareStrings(left, right));

    return [resource.service.iid, propertyKeys];
  });
  const [primaryResourceKey, ...supplementResourceKeys] = resourceKeys;

  if (primaryResourceKey === undefined) {
    throw new TypeError('MIoT endpoint metadata has no primary resource.');
  }
  const [primaryServiceIid, primaryPropertyKeys] = primaryResourceKey;

  return JSON.stringify([
    adapterType,
    metadata.device.did,
    primaryServiceIid,
    primaryPropertyKeys,
    ...supplementResourceKeys,
  ]);
}

function resourcesEqual(
  expected: readonly MiotEndpointConnectionResource[],
  actual: readonly MiotEndpointConnectionResource[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((expectedResource, index) => {
      const actualResource = actual.at(index);

      return (
        actualResource !== undefined &&
        expectedResource.exclusive === actualResource.exclusive &&
        serviceEqual(expectedResource.service, actualResource.service) &&
        propertiesEqual(expectedResource.properties, actualResource.properties)
      );
    })
  );
}

function serviceEqual(
  expected: MiotEndpointConnectionResource['service'],
  actual: MiotEndpointConnectionResource['service'],
): boolean {
  return (
    expected.iid === actual.iid &&
    expected.type === actual.type &&
    expected.description === actual.description
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
    left.format === right.format &&
    left.unit === right.unit &&
    valueRangesEqual(left['value-range'], right['value-range']) &&
    valueListsEqual(left['value-list'], right['value-list']) &&
    uniqueStringArraysEqual(left.access, right.access)
  );
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

  const leftEntryMap = createValueListEntryMap(left);
  const rightEntryMap = createValueListEntryMap(right);

  if (
    leftEntryMap === undefined ||
    rightEntryMap === undefined ||
    leftEntryMap.size !== rightEntryMap.size
  ) {
    return false;
  }

  return [...leftEntryMap].every(([value, description]) => {
    return rightEntryMap.get(value) === description;
  });
}

function createValueListEntryMap(
  valueList: NonNullable<MiotSpecProperty['value-list']>,
): ReadonlyMap<number, string> | undefined {
  if (valueList.length === 0) {
    return undefined;
  }

  const entryMap = new Map<number, string>();

  for (const {value, description} of valueList) {
    if (!Number.isFinite(value) || entryMap.has(value)) {
      return undefined;
    }

    entryMap.set(value, description);
  }

  return entryMap;
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
