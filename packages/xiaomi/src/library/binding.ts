import {
  type EndpointPath,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
} from '@homelib/core';

import type {BackendDevice} from './backend/index.js';
import type {MiotProviderConfiguration} from './configuration.js';
import {getMiotEndpointAdapter} from './devices/index.js';
import {miotEndpointConnectionMetadataEqual} from './endpoint-adapter.js';
import {
  type MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKeys,
  normalizeMiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import {MiotSpecClient, type MiotSpecInstance} from './miot/index.js';

const SPEC_REQUEST_CONCURRENCY = 6;
const DEFAULT_MIOT_SPEC_CLIENT = new MiotSpecClient();

export async function discoverMiotBindingDevices(
  provider: MiotBindingDiscoveryProvider,
  endpoints: readonly ProviderBindingEndpoint[],
  specClient: Pick<MiotSpecClient, 'getInstance'> = DEFAULT_MIOT_SPEC_CLIENT,
): Promise<MiotBindingDiscovery> {
  const discovery = await provider.configuration.discoverDevices();

  if (discovery === undefined) {
    throw new Error('configure this miot provider before binding devices.');
  }

  const specTypeSet = new Set<string>();

  for (const device of discovery.devices) {
    if (device.model !== undefined && device.specType !== undefined) {
      specTypeSet.add(device.specType);
    }
  }

  const specMap = await loadSpecInstances(
    [...specTypeSet],
    specClient,
    SPEC_REQUEST_CONCURRENCY,
  );
  const devices: MiotBindingDeviceCandidate[] = [];
  let failedDeviceCount = 0;
  let incompleteDeviceCount = 0;

  for (const device of discovery.devices) {
    if (device.model === undefined || device.specType === undefined) {
      incompleteDeviceCount++;
      continue;
    }

    const spec = specMap.get(device.specType);

    if (spec === undefined) {
      failedDeviceCount++;
      continue;
    }

    const candidate = createBindingDeviceCandidate(
      {...device, model: device.model, specType: device.specType},
      spec,
      endpoints,
    );

    if (candidate !== undefined) {
      devices.push(candidate);
    }
  }

  devices.sort(
    (left, right) =>
      getDeviceMatchScore(right.device, endpoints) -
      getDeviceMatchScore(left.device, endpoints),
  );

  return {devices, failedDeviceCount, incompleteDeviceCount};
}

export type MiotBindingDiscovery = {
  readonly devices: readonly MiotBindingDeviceCandidate[];
  readonly failedDeviceCount: number;
  readonly incompleteDeviceCount: number;
};

export type MiotBindingDiscoveryProvider = {
  readonly configuration: Pick<MiotProviderConfiguration, 'discoverDevices'>;
};

export type MiotBindingDeviceCandidate = {
  readonly key: string;
  readonly device: BackendDevice;
  readonly endpoints: readonly MiotBindingEndpointCandidate[];
};

export type MiotBindingEndpointCandidate = {
  readonly endpoint: ProviderBindingEndpoint;
  readonly matches: readonly MiotBindingMatchCandidate[];
};

export type MiotBindingMatchCandidate = {
  readonly key: string;
  readonly resourceKeys: readonly string[];
  readonly label: string;
  readonly metadata: MiotEndpointConnectionMetadata;
};

export type MiotBindingEndpointDraft =
  {readonly type: 'match'; readonly matchKey: string} | {readonly type: 'skip'};

export type MiotBindingDeviceDraft = Readonly<
  Record<string, MiotBindingEndpointDraft | undefined>
>;

export type MiotBindingResourceBinding = {
  readonly endpoint: EndpointPath;
  readonly metadata: unknown;
};

export type MiotBindingDeviceProposal = {
  readonly device: MiotBindingDeviceCandidate;
  readonly endpoints: readonly MiotBindingEndpointProposal[];
  readonly bindings: readonly MiotBindingProposalBinding[];
};

export type MiotBindingEndpointProposal =
  | MiotBindingResolvedEndpointProposal
  | {
      readonly status: 'ambiguous' | 'unavailable';
      readonly endpoint: MiotBindingEndpointCandidate;
      readonly matches: readonly MiotBindingMatchCandidate[];
    }
  | {
      readonly status: 'missing' | 'skipped';
      readonly endpoint: MiotBindingEndpointCandidate;
    };

export type MiotBindingResolvedEndpointProposal = {
  readonly status: 'automatic' | 'manual' | 'existing';
  readonly endpoint: MiotBindingEndpointCandidate;
  readonly match: MiotBindingMatchCandidate;
};

export type MiotBindingProposalBinding = {
  readonly endpoint: EndpointPath;
  readonly metadata: MiotEndpointConnectionMetadata;
};

export function resolveMiotBindingDeviceProposal(
  device: MiotBindingDeviceCandidate,
  providerBindings: readonly MiotBindingResourceBinding[],
  draft: MiotBindingDeviceDraft = {},
): MiotBindingDeviceProposal {
  const providerBindingMap = new Map(
    providerBindings.map(binding => [
      getEndpointPathKey(binding.endpoint),
      binding,
    ]),
  );
  const existingMatchMap = new Map<string, MiotBindingMatchCandidate>();

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const existingMatch = findExistingMatch(
      endpoint,
      providerBindingMap.get(endpointPathKey)?.metadata,
    );

    if (existingMatch !== undefined) {
      existingMatchMap.set(endpointPathKey, existingMatch);
    }
  }

  const occupiedResourceMap = new Map<string, string>();

  for (const binding of providerBindings) {
    let metadata: MiotEndpointConnectionMetadata;

    try {
      metadata = normalizeMiotEndpointConnectionMetadata(binding.metadata);
    } catch {
      continue;
    }

    const endpointPathKey = getEndpointPathKey(binding.endpoint);
    for (const resourceKey of getMiotEndpointConnectionResourceKeys(metadata)) {
      occupiedResourceMap.set(resourceKey, endpointPathKey);
    }
  }

  const draftMatchMap = new Map<string, MiotBindingMatchCandidate>();

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const endpointDraft = draft[endpointPathKey];

    if (endpointDraft?.type !== 'match') {
      continue;
    }

    const match = endpoint.matches.find(
      item => item.key === endpointDraft.matchKey,
    );

    if (match !== undefined) {
      draftMatchMap.set(endpointPathKey, match);
    }
  }

  const viableDraftEndpointPathKeySet = findViableDraftEndpoints(
    draftMatchMap,
    occupiedResourceMap,
  );
  const activeOccupiedResourceMap = new Map(
    [...occupiedResourceMap].filter(
      ([_resourceKey, ownerEndpointPathKey]) =>
        !viableDraftEndpointPathKeySet.has(ownerEndpointPathKey),
    ),
  );

  const endpointProposalMap = new Map<string, MiotBindingEndpointProposal>();
  const reservedResourceKeySet = new Set<string>();
  const unresolvedEndpoints: MiotBindingEndpointCandidate[] = [];

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const endpointDraft = draft[endpointPathKey];
    const existingMatch = existingMatchMap.get(endpointPathKey);

    if (endpointDraft?.type === 'skip') {
      if (existingMatch !== undefined) {
        reserveResourceKeys(reservedResourceKeySet, existingMatch.resourceKeys);
      }

      endpointProposalMap.set(endpointPathKey, {
        status: 'skipped',
        endpoint,
      });
      continue;
    }

    if (endpointDraft?.type === 'match') {
      const match = draftMatchMap.get(endpointPathKey);

      if (
        match === undefined ||
        !viableDraftEndpointPathKeySet.has(endpointPathKey) ||
        areResourcesUnavailable(
          match.resourceKeys,
          endpointPathKey,
          activeOccupiedResourceMap,
          reservedResourceKeySet,
        )
      ) {
        endpointProposalMap.set(endpointPathKey, {
          status: 'unavailable',
          endpoint,
          matches: getAvailableMatches(
            endpoint,
            endpointPathKey,
            activeOccupiedResourceMap,
            reservedResourceKeySet,
          ),
        });
      } else {
        reserveResourceKeys(reservedResourceKeySet, match.resourceKeys);
        endpointProposalMap.set(endpointPathKey, {
          status: 'manual',
          endpoint,
          match,
        });
      }

      continue;
    }

    if (existingMatch !== undefined) {
      reserveResourceKeys(reservedResourceKeySet, existingMatch.resourceKeys);
      endpointProposalMap.set(endpointPathKey, {
        status: 'existing',
        endpoint,
        match: existingMatch,
      });
      continue;
    }

    unresolvedEndpoints.push(endpoint);
  }

  const availableMatchMap = new Map<
    string,
    readonly MiotBindingMatchCandidate[]
  >();

  for (const endpoint of unresolvedEndpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);

    availableMatchMap.set(
      endpointPathKey,
      getAvailableMatches(
        endpoint,
        endpointPathKey,
        activeOccupiedResourceMap,
        reservedResourceKeySet,
      ),
    );
  }

  const maximumMatching = findMaximumMatchPacking(
    unresolvedEndpoints,
    availableMatchMap,
  );

  for (const endpoint of unresolvedEndpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const availableMatches = availableMatchMap.get(endpointPathKey) ?? [];
    const matchedMatch = maximumMatching.get(endpointPathKey);

    if (endpoint.matches.length === 0) {
      endpointProposalMap.set(endpointPathKey, {status: 'missing', endpoint});
    } else if (availableMatches.length === 0) {
      endpointProposalMap.set(endpointPathKey, {
        status: 'unavailable',
        endpoint,
        matches: [],
      });
    } else if (
      matchedMatch !== undefined &&
      isForcedMatch(
        unresolvedEndpoints,
        availableMatchMap,
        maximumMatching.size,
        endpointPathKey,
        matchedMatch.key,
      )
    ) {
      endpointProposalMap.set(endpointPathKey, {
        status: 'automatic',
        endpoint,
        match: matchedMatch,
      });
    } else {
      endpointProposalMap.set(endpointPathKey, {
        status: 'ambiguous',
        endpoint,
        matches: availableMatches,
      });
    }
  }

  const endpointProposals = device.endpoints.map(({endpoint}) => {
    const proposal = endpointProposalMap.get(getEndpointPathKey(endpoint.path));

    if (proposal === undefined) {
      throw new TypeError('Missing MIoT endpoint proposal.');
    }

    return proposal;
  });
  const bindings = endpointProposals.flatMap(proposal => {
    if (proposal.status !== 'automatic' && proposal.status !== 'manual') {
      return [];
    }

    return [
      {
        endpoint: proposal.endpoint.endpoint.path,
        metadata: proposal.match.metadata,
      },
    ];
  });

  return {
    device,
    endpoints: endpointProposals,
    bindings,
  };
}

function createBindingDeviceCandidate(
  device: BackendDevice & {readonly model: string; readonly specType: string},
  spec: MiotSpecInstance,
  endpoints: readonly ProviderBindingEndpoint[],
): MiotBindingDeviceCandidate | undefined {
  const endpointCandidates = endpoints.map(endpoint => ({
    endpoint,
    matches: createBindingMatchCandidates(device, spec, endpoint),
  }));

  if (endpointCandidates.every(endpoint => endpoint.matches.length === 0)) {
    return undefined;
  }

  return {
    key: device.did,
    device,
    endpoints: endpointCandidates,
  };
}

function createBindingMatchCandidates(
  device: BackendDevice & {readonly model: string},
  spec: MiotSpecInstance,
  endpoint: ProviderBindingEndpoint,
): readonly MiotBindingMatchCandidate[] {
  const endpointAdapter = getMiotEndpointAdapter(endpoint.endpoint);

  if (endpointAdapter === undefined) {
    return [];
  }

  return endpointAdapter
    .findMetadataCandidates(device, spec)
    .map(({key, label, metadata}) => ({
      key,
      resourceKeys: getMiotEndpointConnectionResourceKeys(metadata),
      label,
      metadata,
    }));
}

function findExistingMatch(
  endpoint: MiotBindingEndpointCandidate,
  metadataValue: unknown,
): MiotBindingMatchCandidate | undefined {
  if (metadataValue === undefined) {
    return undefined;
  }

  try {
    const metadata = normalizeMiotEndpointConnectionMetadata(metadataValue);
    const endpointAdapter = getMiotEndpointAdapter(endpoint.endpoint.endpoint);

    if (endpointAdapter === undefined) {
      return undefined;
    }

    return endpoint.matches.find(match =>
      miotEndpointConnectionMetadataEqual(match.metadata, metadata),
    );
  } catch {
    return undefined;
  }
}

function getAvailableMatches(
  endpoint: MiotBindingEndpointCandidate,
  endpointPathKey: string,
  occupiedResourceMap: ReadonlyMap<string, string>,
  reservedResourceKeySet: ReadonlySet<string>,
): readonly MiotBindingMatchCandidate[] {
  const matchMap = new Map<string, MiotBindingMatchCandidate>();

  for (const match of endpoint.matches) {
    if (
      areResourcesUnavailable(
        match.resourceKeys,
        endpointPathKey,
        occupiedResourceMap,
        reservedResourceKeySet,
      )
    ) {
      continue;
    }

    matchMap.set(match.key, match);
  }

  return [...matchMap.values()];
}

function findViableDraftEndpoints(
  draftMatchMap: ReadonlyMap<string, MiotBindingMatchCandidate>,
  occupiedResourceMap: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const viableEndpointPathKeySet = new Set(draftMatchMap.keys());

  while (true) {
    const invalidEndpointPathKeySet = new Set<string>();
    const draftResourceOwnerMap = new Map<string, string>();

    for (const endpointPathKey of viableEndpointPathKeySet) {
      const match = draftMatchMap.get(endpointPathKey);

      if (match === undefined) {
        throw new TypeError('Missing MIoT binding draft match.');
      }

      for (const resourceKey of match.resourceKeys) {
        const currentOwnerEndpointPathKey =
          occupiedResourceMap.get(resourceKey);

        if (
          currentOwnerEndpointPathKey !== undefined &&
          currentOwnerEndpointPathKey !== endpointPathKey &&
          !viableEndpointPathKeySet.has(currentOwnerEndpointPathKey)
        ) {
          invalidEndpointPathKeySet.add(endpointPathKey);
        }

        const draftOwnerEndpointPathKey =
          draftResourceOwnerMap.get(resourceKey);

        if (
          draftOwnerEndpointPathKey !== undefined &&
          draftOwnerEndpointPathKey !== endpointPathKey
        ) {
          invalidEndpointPathKeySet.add(endpointPathKey);
          invalidEndpointPathKeySet.add(draftOwnerEndpointPathKey);
        } else {
          draftResourceOwnerMap.set(resourceKey, endpointPathKey);
        }
      }
    }

    if (invalidEndpointPathKeySet.size === 0) {
      return viableEndpointPathKeySet;
    }

    for (const endpointPathKey of invalidEndpointPathKeySet) {
      viableEndpointPathKeySet.delete(endpointPathKey);
    }
  }
}

function areResourcesUnavailable(
  resourceKeys: readonly string[],
  endpointPathKey: string,
  occupiedResourceMap: ReadonlyMap<string, string>,
  reservedResourceKeySet: ReadonlySet<string>,
): boolean {
  return resourceKeys.some(resourceKey => {
    const ownerEndpointPathKey = occupiedResourceMap.get(resourceKey);

    return (
      reservedResourceKeySet.has(resourceKey) ||
      (ownerEndpointPathKey !== undefined &&
        ownerEndpointPathKey !== endpointPathKey)
    );
  });
}

function findMaximumMatchPacking(
  endpoints: readonly MiotBindingEndpointCandidate[],
  availableMatchMap: ReadonlyMap<string, readonly MiotBindingMatchCandidate[]>,
  excludedEdge?: {
    readonly endpointPathKey: string;
    readonly matchKey: string;
  },
): ReadonlyMap<string, MiotBindingMatchCandidate> {
  const orderedEndpoints = [...endpoints].sort((left, right) => {
    return (
      getMatches(left).length - getMatches(right).length ||
      compareStrings(
        getEndpointPathKey(left.endpoint.path),
        getEndpointPathKey(right.endpoint.path),
      )
    );
  });
  const resourceKeySet = new Set<string>();
  const matching = new Map<string, MiotBindingMatchCandidate>();
  let maximumMatching = new Map<string, MiotBindingMatchCandidate>();

  search(0);

  return maximumMatching;

  function search(index: number): void {
    if (
      matching.size + orderedEndpoints.length - index <=
      maximumMatching.size
    ) {
      return;
    }

    const endpoint = orderedEndpoints.at(index);

    if (endpoint === undefined) {
      maximumMatching = new Map(matching);
      return;
    }

    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);

    for (const match of getMatches(endpoint)) {
      if (
        (excludedEdge?.endpointPathKey === endpointPathKey &&
          excludedEdge.matchKey === match.key) ||
        match.resourceKeys.some(resourceKey => resourceKeySet.has(resourceKey))
      ) {
        continue;
      }

      matching.set(endpointPathKey, match);
      reserveResourceKeys(resourceKeySet, match.resourceKeys);
      search(index + 1);
      matching.delete(endpointPathKey);

      for (const resourceKey of match.resourceKeys) {
        resourceKeySet.delete(resourceKey);
      }
    }

    search(index + 1);
  }

  function getMatches(
    endpoint: MiotBindingEndpointCandidate,
  ): readonly MiotBindingMatchCandidate[] {
    return (
      availableMatchMap.get(getEndpointPathKey(endpoint.endpoint.path)) ?? []
    );
  }
}

function isForcedMatch(
  endpoints: readonly MiotBindingEndpointCandidate[],
  availableMatchMap: ReadonlyMap<string, readonly MiotBindingMatchCandidate[]>,
  maximumMatchingSize: number,
  endpointPathKey: string,
  matchKey: string,
): boolean {
  return (
    findMaximumMatchPacking(endpoints, availableMatchMap, {
      endpointPathKey,
      matchKey,
    }).size < maximumMatchingSize
  );
}

function reserveResourceKeys(
  resourceKeySet: Set<string>,
  resourceKeys: readonly string[],
): void {
  for (const resourceKey of resourceKeys) {
    resourceKeySet.add(resourceKey);
  }
}

function getDeviceMatchScore(
  device: BackendDevice,
  endpoints: readonly ProviderBindingEndpoint[],
): number {
  let score = 0;

  for (const endpoint of endpoints) {
    let endpointScore = 0;

    if (device.name === endpoint.path.deviceName) {
      endpointScore += 2;
    }

    if (device.roomName === endpoint.path.scopePath.at(-1)) {
      endpointScore += 1;
    }

    if (isCurrentMiotDevice(endpoint, device.did)) {
      endpointScore += 4;
    }

    score = Math.max(score, endpointScore);
  }

  return score;
}

function isCurrentMiotDevice(
  endpoint: ProviderBindingEndpoint,
  did: string,
): boolean {
  if (endpoint.binding === undefined) {
    return false;
  }

  try {
    const metadata = normalizeMiotEndpointConnectionMetadata(
      endpoint.binding.metadata,
    );

    return metadata.device.did === did;
  } catch {
    return false;
  }
}

async function loadSpecInstances(
  urns: readonly string[],
  specClient: Pick<MiotSpecClient, 'getInstance'>,
  concurrency: number,
): Promise<ReadonlyMap<string, MiotSpecInstance>> {
  const specMap = new Map<string, MiotSpecInstance>();
  let nextIndex = 0;

  const loadNext = async (): Promise<void> => {
    while (true) {
      const urn = urns.at(nextIndex);

      if (urn === undefined) {
        return;
      }

      nextIndex++;

      try {
        specMap.set(urn, await specClient.getInstance(urn));
      } catch {
        // Failed specs are counted per affected device by the caller.
      }
    }
  };
  const workerCount = Math.min(concurrency, urns.length);

  await Promise.all(
    Array.from({length: workerCount}, async () => {
      await loadNext();
    }),
  );

  return specMap;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  }

  return 0;
}
