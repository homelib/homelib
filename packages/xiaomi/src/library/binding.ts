import {
  type EndpointPath,
  type ProviderBindingDevice,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
} from '@homelib/core';

import type {BackendDevice} from './backend/index.js';
import type {MiotProviderConfiguration} from './configuration.js';
import {
  createMiotEndpointConnectionMetadata,
  matchMiotDevice,
  miotEndpointConnectionMetadataEqual,
} from './device.js';
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
  logicalDevice: ProviderBindingDevice,
  specClient: Pick<MiotSpecClient, 'getInstance'> = DEFAULT_MIOT_SPEC_CLIENT,
): Promise<MiotBindingDiscovery> {
  const {endpoints} = logicalDevice;
  const discovery = await provider.configuration.discoverDevices();

  if (discovery === undefined) {
    throw new Error('configure this miot provider before binding devices.');
  }

  const specTypeSet = new Set<string>();

  for (const device of discovery.devices) {
    if (device.specType !== undefined) {
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
    if (device.specType === undefined) {
      incompleteDeviceCount++;
      continue;
    }

    const spec = specMap.get(device.specType);

    if (spec === undefined) {
      failedDeviceCount++;
      continue;
    }

    const candidate = createBindingDeviceCandidate(
      {...device, specType: device.specType},
      spec,
      logicalDevice,
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
  readonly metadata: MiotEndpointConnectionMetadata;
  readonly resourceKeys: readonly string[];
  readonly label: string;
};

export type MiotBindingResourceBinding = {
  readonly endpoint: EndpointPath;
  readonly metadata: unknown;
};

export type MiotBindingDeviceProposal = {
  readonly status: 'automatic' | 'existing' | 'unavailable';
  readonly device: MiotBindingDeviceCandidate;
  readonly endpoints: readonly MiotBindingEndpointProposal[];
  readonly bindings: readonly MiotBindingProposalBinding[];
};

export type MiotBindingEndpointProposal = {
  readonly status: 'automatic' | 'existing' | 'unavailable';
  readonly endpoint: MiotBindingEndpointCandidate;
};

export type MiotBindingProposalBinding = {
  readonly endpoint: EndpointPath;
  readonly metadata: MiotEndpointConnectionMetadata;
};

export function resolveMiotBindingDeviceProposal(
  device: MiotBindingDeviceCandidate,
  providerBindings: readonly MiotBindingResourceBinding[],
): MiotBindingDeviceProposal {
  const candidateEndpointPathKeySet = new Set(
    device.endpoints.map(({endpoint}) => getEndpointPathKey(endpoint.path)),
  );
  const providerBindingMap = new Map(
    providerBindings.map(binding => [
      getEndpointPathKey(binding.endpoint),
      binding,
    ]),
  );
  const occupiedResourceMap = getOccupiedResourceMap(providerBindings);
  const existingEndpointPathKeySet = new Set<string>();
  let resourcesUnavailable = false;

  for (const endpoint of device.endpoints) {
    const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
    const existingMetadata = normalizeMetadata(
      providerBindingMap.get(endpointPathKey)?.metadata,
    );

    if (
      existingMetadata !== undefined &&
      miotEndpointConnectionMetadataEqual(endpoint.metadata, existingMetadata)
    ) {
      existingEndpointPathKeySet.add(endpointPathKey);
    }
  }

  const replaceableEndpointPathKeySet = new Set(
    device.endpoints.flatMap(({endpoint}) => {
      const endpointPathKey = getEndpointPathKey(endpoint.path);

      if (
        existingEndpointPathKeySet.has(endpointPathKey) ||
        endpoint.binding === undefined ||
        providerBindingMap.has(endpointPathKey)
      ) {
        return [endpointPathKey];
      }

      return [];
    }),
  );

  for (const endpoint of device.endpoints) {
    for (const resourceKey of endpoint.resourceKeys) {
      const ownerEndpointPathKey = occupiedResourceMap.get(resourceKey);

      if (
        ownerEndpointPathKey !== undefined &&
        (!candidateEndpointPathKeySet.has(ownerEndpointPathKey) ||
          !replaceableEndpointPathKeySet.has(ownerEndpointPathKey))
      ) {
        resourcesUnavailable = true;
      }
    }
  }

  if (resourcesUnavailable) {
    return {
      status: 'unavailable',
      device,
      endpoints: device.endpoints.map(endpoint => ({
        status: existingEndpointPathKeySet.has(
          getEndpointPathKey(endpoint.endpoint.path),
        )
          ? 'existing'
          : 'unavailable',
        endpoint,
      })),
      bindings: [],
    };
  }

  const endpoints: MiotBindingEndpointProposal[] = device.endpoints.map(
    endpoint => ({
      status: existingEndpointPathKeySet.has(
        getEndpointPathKey(endpoint.endpoint.path),
      )
        ? 'existing'
        : 'automatic',
      endpoint,
    }),
  );
  const bindings = endpoints.flatMap(proposal => {
    if (proposal.status !== 'automatic') {
      return [];
    }

    return [
      {
        endpoint: proposal.endpoint.endpoint.path,
        metadata: proposal.endpoint.metadata,
      },
    ];
  });

  return {
    status: bindings.length === 0 ? 'existing' : 'automatic',
    device,
    endpoints,
    bindings,
  };
}

function createBindingDeviceCandidate(
  device: BackendDevice & {readonly specType: string},
  spec: MiotSpecInstance,
  logicalDevice: ProviderBindingDevice,
): MiotBindingDeviceCandidate | undefined {
  const match = matchMiotDevice(logicalDevice, spec);

  if (match === undefined) {
    return undefined;
  }

  const resourceKeySet = new Set<string>();
  const endpointCandidates: MiotBindingEndpointCandidate[] = [];

  for (const {endpoint, resources} of match.endpoints) {
    const metadata = createMiotEndpointConnectionMetadata(
      device,
      spec.type,
      resources,
    );
    const resourceKeys = getMiotEndpointConnectionResourceKeys(metadata);

    if (resourceKeys.some(resourceKey => resourceKeySet.has(resourceKey))) {
      return undefined;
    }

    for (const resourceKey of resourceKeys) {
      resourceKeySet.add(resourceKey);
    }

    endpointCandidates.push({
      endpoint,
      metadata,
      resourceKeys,
      label: resources.map(({service}) => service.description).join(' + '),
    });
  }

  return {key: device.did, device, endpoints: endpointCandidates};
}

function getOccupiedResourceMap(
  providerBindings: readonly MiotBindingResourceBinding[],
): ReadonlyMap<string, string> {
  const occupiedResourceMap = new Map<string, string>();

  for (const binding of providerBindings) {
    const metadata = normalizeMetadata(binding.metadata);

    if (metadata === undefined) {
      continue;
    }

    const endpointPathKey = getEndpointPathKey(binding.endpoint);

    for (const resourceKey of getMiotEndpointConnectionResourceKeys(metadata)) {
      occupiedResourceMap.set(resourceKey, endpointPathKey);
    }
  }

  return occupiedResourceMap;
}

function normalizeMetadata(
  value: unknown,
): MiotEndpointConnectionMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return normalizeMiotEndpointConnectionMetadata(value);
  } catch {
    return undefined;
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
  const metadata = normalizeMetadata(endpoint.binding?.metadata);

  return metadata?.device.did === did;
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
