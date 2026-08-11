import type {ProviderBindingEndpoint} from '@homelib/core';

import type {BackendDevice} from './backend/index.js';
import type {MiotProviderConfiguration} from './configuration.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {MiotEndpointConnectionMetadata} from './endpoint-connection.js';
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
  readonly label: string;
  readonly details: string;
  readonly metadata: MiotEndpointConnectionMetadata;
};

function createBindingDeviceCandidate(
  device: BackendDevice & {readonly model: string; readonly specType: string},
  spec: MiotSpecInstance,
  endpoints: readonly ProviderBindingEndpoint[],
): MiotBindingDeviceCandidate | undefined {
  const endpointCandidates = endpoints.flatMap(endpoint => {
    const services = createBindingServiceCandidates(device, spec, endpoint);

    if (services.length === 0) {
      return [];
    }

    return [{endpoint, services}];
  });

  if (endpointCandidates.length === 0) {
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
      label: `${match.service.description} (siid ${match.service.iid})`,
      details: `on piid ${match.properties.on.iid}`,
      metadata,
    });
  }

  return [...candidateMap.values()];
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
