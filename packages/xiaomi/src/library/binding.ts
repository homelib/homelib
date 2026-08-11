import {
  type EndpointPath,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
} from '@homelib/core';

import type {BackendDevice} from './backend/index.js';
import type {MiotProviderConfiguration} from './configuration.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKey,
} from './endpoint-connection.js';
import {
  type MiotEndpointMatch,
  type MiotPropertyMatcher,
  MiotSpecClient,
  type MiotSpecInstance,
  findMiotEndpointMatches,
} from './miot/index.js';

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
  readonly services: readonly MiotBindingServiceCandidate[];
};

export type MiotBindingServiceCandidate = {
  readonly key: string;
  readonly resourceKey: string;
  readonly label: string;
  readonly metadata: MiotEndpointConnectionMetadata;
};

export type MiotBindingEndpointDraft =
  | {readonly type: 'service'; readonly serviceKey: string}
  | {readonly type: 'skip'};

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
      readonly services: readonly MiotBindingServiceCandidate[];
    }
  | {
      readonly status: 'missing' | 'skipped';
      readonly endpoint: MiotBindingEndpointCandidate;
    };

export type MiotBindingResolvedEndpointProposal = {
  readonly status: 'automatic' | 'manual' | 'existing';
  readonly endpoint: MiotBindingEndpointCandidate;
  readonly service: MiotBindingServiceCandidate;
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
  const existingServiceMap = new Map<string, MiotBindingServiceCandidate>();

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const existingService = findExistingService(
      endpoint,
      providerBindingMap.get(endpointPathKey)?.metadata,
    );

    if (existingService !== undefined) {
      existingServiceMap.set(endpointPathKey, existingService);
    }
  }

  const occupiedResourceMap = new Map<string, string>();

  for (const binding of providerBindings) {
    let metadata: MiotEndpointConnectionMetadata;

    try {
      metadata = MiotEndpointConnectionMetadata.satisfies(binding.metadata);
    } catch {
      continue;
    }

    const endpointPathKey = getEndpointPathKey(binding.endpoint);
    const resourceKey = getMiotEndpointConnectionResourceKey(metadata);

    occupiedResourceMap.set(resourceKey, endpointPathKey);
  }

  const endpointProposalMap = new Map<string, MiotBindingEndpointProposal>();
  const reservedResourceKeySet = new Set<string>();
  const unresolvedEndpoints: MiotBindingEndpointCandidate[] = [];

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const endpointDraft = draft[endpointPathKey];
    const existingService = existingServiceMap.get(endpointPathKey);

    if (endpointDraft?.type === 'skip') {
      if (existingService !== undefined) {
        reservedResourceKeySet.add(existingService.resourceKey);
      }

      endpointProposalMap.set(endpointPathKey, {
        status: 'skipped',
        endpoint,
      });
      continue;
    }

    if (endpointDraft?.type === 'service') {
      const service = endpoint.services.find(
        item => item.key === endpointDraft.serviceKey,
      );

      if (
        service === undefined ||
        isResourceUnavailable(
          service.resourceKey,
          endpointPathKey,
          occupiedResourceMap,
          reservedResourceKeySet,
        )
      ) {
        endpointProposalMap.set(endpointPathKey, {
          status: 'unavailable',
          endpoint,
          services: getAvailableServices(
            endpoint,
            endpointPathKey,
            occupiedResourceMap,
            reservedResourceKeySet,
          ),
        });
      } else {
        reservedResourceKeySet.add(service.resourceKey);
        endpointProposalMap.set(endpointPathKey, {
          status: 'manual',
          endpoint,
          service,
        });
      }

      continue;
    }

    if (existingService !== undefined) {
      reservedResourceKeySet.add(existingService.resourceKey);
      endpointProposalMap.set(endpointPathKey, {
        status: 'existing',
        endpoint,
        service: existingService,
      });
      continue;
    }

    unresolvedEndpoints.push(endpoint);
  }

  const availableServiceMap = new Map<
    string,
    readonly MiotBindingServiceCandidate[]
  >();

  for (const endpoint of unresolvedEndpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);

    availableServiceMap.set(
      endpointPathKey,
      getAvailableServices(
        endpoint,
        endpointPathKey,
        occupiedResourceMap,
        reservedResourceKeySet,
      ),
    );
  }

  const maximumMatching = findMaximumServiceMatching(
    unresolvedEndpoints,
    availableServiceMap,
  );

  for (const endpoint of unresolvedEndpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const availableServices = availableServiceMap.get(endpointPathKey) ?? [];
    const matchedService = maximumMatching.get(endpointPathKey);

    if (endpoint.services.length === 0) {
      endpointProposalMap.set(endpointPathKey, {status: 'missing', endpoint});
    } else if (availableServices.length === 0) {
      endpointProposalMap.set(endpointPathKey, {
        status: 'unavailable',
        endpoint,
        services: [],
      });
    } else if (
      matchedService !== undefined &&
      isForcedServiceMatch(
        unresolvedEndpoints,
        availableServiceMap,
        maximumMatching.size,
        endpointPathKey,
        matchedService.resourceKey,
      )
    ) {
      endpointProposalMap.set(endpointPathKey, {
        status: 'automatic',
        endpoint,
        service: matchedService,
      });
    } else {
      endpointProposalMap.set(endpointPathKey, {
        status: 'ambiguous',
        endpoint,
        services: availableServices,
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
        metadata: proposal.service.metadata,
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
    services: createBindingServiceCandidates(device, spec, endpoint),
  }));

  if (endpointCandidates.every(endpoint => endpoint.services.length === 0)) {
    return undefined;
  }

  return {
    key: device.did,
    device,
    endpoints: endpointCandidates,
  };
}

function createBindingServiceCandidates(
  device: BackendDevice & {readonly model: string},
  spec: MiotSpecInstance,
  endpoint: ProviderBindingEndpoint,
): readonly MiotBindingServiceCandidate[] {
  if (!(endpoint.endpoint instanceof MiotLightEndpointConnection.Endpoint)) {
    return [];
  }

  const matches: Array<MiotEndpointMatch<{readonly on: MiotPropertyMatcher}>> =
    MiotLightEndpointConnection.endpointMatchers.flatMap(matcher =>
      findMiotEndpointMatches(spec, matcher),
    );
  const candidateMap = new Map<string, MiotBindingServiceCandidate>();

  for (const match of matches) {
    const metadata = MiotEndpointConnectionMetadata.satisfies({
      device: {did: device.did, model: device.model, urn: spec.type},
      service: match.service,
      properties: match.properties,
    });

    MiotLightEndpointConnection.assertMetadata(metadata);

    const key = JSON.stringify([
      'light',
      device.did,
      match.service.iid,
      match.properties.on.iid,
    ]);

    candidateMap.set(key, {
      key,
      resourceKey: getMiotEndpointConnectionResourceKey(metadata),
      label: match.service.description,
      metadata,
    });
  }

  return [...candidateMap.values()];
}

function findExistingService(
  endpoint: MiotBindingEndpointCandidate,
  metadataValue: unknown,
): MiotBindingServiceCandidate | undefined {
  if (metadataValue === undefined) {
    return undefined;
  }

  try {
    const metadata = MiotEndpointConnectionMetadata.satisfies(metadataValue);
    const resourceKey = getMiotEndpointConnectionResourceKey(metadata);

    return endpoint.services.find(
      service => service.resourceKey === resourceKey,
    );
  } catch {
    return undefined;
  }
}

function getAvailableServices(
  endpoint: MiotBindingEndpointCandidate,
  endpointPathKey: string,
  occupiedResourceMap: ReadonlyMap<string, string>,
  reservedResourceKeySet: ReadonlySet<string>,
): readonly MiotBindingServiceCandidate[] {
  const serviceMap = new Map<string, MiotBindingServiceCandidate>();

  for (const service of endpoint.services) {
    if (
      isResourceUnavailable(
        service.resourceKey,
        endpointPathKey,
        occupiedResourceMap,
        reservedResourceKeySet,
      )
    ) {
      continue;
    }

    serviceMap.set(service.resourceKey, service);
  }

  return [...serviceMap.values()];
}

function isResourceUnavailable(
  resourceKey: string,
  endpointPathKey: string,
  occupiedResourceMap: ReadonlyMap<string, string>,
  reservedResourceKeySet: ReadonlySet<string>,
): boolean {
  const ownerEndpointPathKey = occupiedResourceMap.get(resourceKey);

  return (
    reservedResourceKeySet.has(resourceKey) ||
    (ownerEndpointPathKey !== undefined &&
      ownerEndpointPathKey !== endpointPathKey)
  );
}

function findMaximumServiceMatching(
  endpoints: readonly MiotBindingEndpointCandidate[],
  availableServiceMap: ReadonlyMap<
    string,
    readonly MiotBindingServiceCandidate[]
  >,
  excludedEdge?: {
    readonly endpointPathKey: string;
    readonly resourceKey: string;
  },
): ReadonlyMap<string, MiotBindingServiceCandidate> {
  const resourceOwnerMap = new Map<string, string>();
  const endpointServiceMap = new Map<string, MiotBindingServiceCandidate>();

  const assignEndpoint = (
    endpointPathKey: string,
    visitedResourceKeySet: Set<string>,
  ): boolean => {
    const services = availableServiceMap.get(endpointPathKey) ?? [];

    for (const service of services) {
      if (
        (excludedEdge?.endpointPathKey === endpointPathKey &&
          excludedEdge.resourceKey === service.resourceKey) ||
        visitedResourceKeySet.has(service.resourceKey)
      ) {
        continue;
      }

      visitedResourceKeySet.add(service.resourceKey);
      const currentOwner = resourceOwnerMap.get(service.resourceKey);

      if (
        currentOwner !== undefined &&
        !assignEndpoint(currentOwner, visitedResourceKeySet)
      ) {
        continue;
      }

      resourceOwnerMap.set(service.resourceKey, endpointPathKey);
      endpointServiceMap.set(endpointPathKey, service);

      return true;
    }

    return false;
  };

  for (const endpoint of endpoints) {
    assignEndpoint(
      getEndpointPathKey(endpoint.endpoint.path),
      new Set<string>(),
    );
  }

  return endpointServiceMap;
}

function isForcedServiceMatch(
  endpoints: readonly MiotBindingEndpointCandidate[],
  availableServiceMap: ReadonlyMap<
    string,
    readonly MiotBindingServiceCandidate[]
  >,
  maximumMatchingSize: number,
  endpointPathKey: string,
  resourceKey: string,
): boolean {
  return (
    findMaximumServiceMatching(endpoints, availableServiceMap, {
      endpointPathKey,
      resourceKey,
    }).size < maximumMatchingSize
  );
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
    const metadata = MiotEndpointConnectionMetadata.satisfies(
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
