import {
  EndpointPath,
  Fan,
  FanEndpoint,
  Light,
  LightEndpoint,
  type ProviderBindingDevice,
  type ProviderBindingEndpoint,
  type ProviderBindingRecord,
  ProviderName,
  type RuntimeProvider,
} from '@homelib/core';

import {
  type MiotBindingDeviceCandidate,
  type MiotBindingDiscoveryProvider,
  type MiotBindingEndpointCandidate,
  type MiotBindingResourceBinding,
  discoverMiotBindingDevices,
  prepareMiotBindingResourceBindings,
  resolveMiotBindingDeviceProposal,
} from '../binding.js';
import {createMiotEndpointConnectionMetadata} from '../device.js';
import {
  type MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  createMiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionResourceKeys,
} from '../endpoint-connection/index.js';
import type {
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from '../miot/index.js';
import '../index.js';

test('discovers one exact whole-device mapping and persists only identity', async () => {
  const endpoint = createLogicalEndpoint('', new LightEndpoint());
  const logicalDevice = createLogicalDevice(Light, [endpoint]);
  const provider = createDiscoveryProvider([
    {
      did: 'physical-light',
      name: 'Ceiling Light',
      model: 'test.light',
      specType: LIGHT_SPEC.type,
    },
  ]);

  const discovery = await discoverMiotBindingDevices(provider, logicalDevice, {
    getInstance: async () => LIGHT_SPEC,
  });
  const candidate = discovery.devices[0];
  const physicalEndpoint = candidate?.endpoints[0];

  expect(discovery.devices).toHaveLength(1);
  expect(candidate?.device.did).toBe('physical-light');
  expect(physicalEndpoint?.endpoint).toBe(endpoint);
  expect(physicalEndpoint?.metadata).toMatchObject({
    version: 1,
    device: {
      did: 'physical-light',
      model: 'test.light',
      urn: LIGHT_SPEC.type,
    },
  });
  expect(physicalEndpoint?.metadata).not.toHaveProperty('resources');
  expect(physicalEndpoint?.resourceKeys).toEqual([
    JSON.stringify(['physical-light', 2]),
  ]);
});

test('requires the registered endpoint set but not endpoint names to match', async () => {
  const provider = createDiscoveryProvider([
    {did: 'physical-light', specType: LIGHT_SPEC.type},
  ]);
  const specClient = {getInstance: async () => LIGHT_SPEC};

  const missing = await discoverMiotBindingDevices(
    provider,
    createLogicalDevice(Light, []),
    specClient,
  );
  const renamed = await discoverMiotBindingDevices(
    provider,
    createLogicalDevice(Light, [
      createLogicalEndpoint('accent', new LightEndpoint('accent')),
    ]),
    specClient,
  );
  const extra = await discoverMiotBindingDevices(
    provider,
    createLogicalDevice(Light, [
      createLogicalEndpoint('', new LightEndpoint()),
      createLogicalEndpoint('accent', new LightEndpoint('accent')),
    ]),
    specClient,
  );

  expect(missing.devices).toEqual([]);
  expect(renamed.devices).toHaveLength(1);
  expect(extra.devices).toEqual([]);
});

test('matches the whole device by its Core device constructor', async () => {
  const discovery = await discoverMiotBindingDevices(
    createDiscoveryProvider([
      {did: 'physical-light', specType: LIGHT_SPEC.type},
    ]),
    createLogicalDevice(Fan, [createLogicalEndpoint('', new FanEndpoint())]),
    {getInstance: async () => LIGHT_SPEC},
  );

  expect(discovery.devices).toEqual([]);
});

test('matches a physical device without a model when its spec type is available', async () => {
  const discovery = await discoverMiotBindingDevices(
    createDiscoveryProvider([
      {did: 'without-model', specType: LIGHT_SPEC.type},
      {did: 'without-spec-type', model: 'test.light'},
    ]),
    createLogicalDevice(Light, [
      createLogicalEndpoint('', new LightEndpoint()),
    ]),
    {getInstance: async () => LIGHT_SPEC},
  );

  expect(discovery.devices).toHaveLength(1);
  expect(discovery.devices[0]?.device.did).toBe('without-model');
  expect(discovery.devices[0]?.endpoints[0]?.metadata.device.model).toBe(
    undefined,
  );
  expect(discovery.incompleteDeviceCount).toBe(1);
});

test('distinguishes missing authorization from no compatible devices', async () => {
  const provider = {configuration: {discoverDevices: async () => undefined}};

  await expect(
    discoverMiotBindingDevices(provider, createLogicalDevice(Light, [])),
  ).rejects.toThrow('configure this miot provider before binding devices.');
});

test('loads each spec once with bounded concurrency', async () => {
  let activeRequestCount = 0;
  let maximumActiveRequestCount = 0;
  let requestCount = 0;
  const devices = Array.from({length: 14}, (_value, index) => ({
    did: `device-${index}`,
    specType: `${LIGHT_SPEC.type}:${index}`,
  }));

  const discovery = await discoverMiotBindingDevices(
    createDiscoveryProvider(devices),
    createLogicalDevice(Light, [
      createLogicalEndpoint('', new LightEndpoint()),
    ]),
    {
      getInstance: async urn => {
        requestCount++;
        activeRequestCount++;
        maximumActiveRequestCount = Math.max(
          maximumActiveRequestCount,
          activeRequestCount,
        );
        await new Promise<void>(resolve => {
          setImmediate(resolve);
        });
        activeRequestCount--;
        return {...LIGHT_SPEC, type: urn};
      },
    },
  );

  expect(requestCount).toBe(14);
  expect(maximumActiveRequestCount).toBe(6);
  expect(discovery.devices).toHaveLength(14);
});

test('reuses the default MIoT spec client across discovery reloads', async () => {
  const originalFetch = globalThis.fetch;
  const spec = {
    ...LIGHT_SPEC,
    type: 'urn:miot-spec-v2:device:light:0000A001:binding-cache-test:1',
  };
  const provider = createDiscoveryProvider([
    {
      did: 'cached-device',
      model: 'test.light',
      specType: spec.type,
    },
  ]);
  const logicalDevice = createLogicalDevice(Light, [
    createLogicalEndpoint('', new LightEndpoint()),
  ]);
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount++;
    return new Response(JSON.stringify(spec));
  };

  try {
    const first = await discoverMiotBindingDevices(provider, logicalDevice);
    const second = await discoverMiotBindingDevices(provider, logicalDevice);

    expect(first.devices).toHaveLength(1);
    expect(second.devices).toHaveLength(1);
    expect(fetchCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatically proposes the complete available physical mapping', () => {
  const device = createCandidate([
    createCandidateEndpoint('', 2),
    createCandidateEndpoint('accent', 3),
  ]);
  const proposal = resolveMiotBindingDeviceProposal(device, []);

  expect(proposal.status).toBe('automatic');
  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'automatic',
    'automatic',
  ]);
  expect(proposal.bindings.map(({endpoint}) => endpoint.endpointName)).toEqual([
    '',
    'accent',
  ]);
});

test('rejects duplicate resources resolved from active binding records', async () => {
  const first = createLogicalEndpoint('', new LightEndpoint());
  const second = createLogicalEndpoint('accent', new LightEndpoint('accent'));
  const provider: RuntimeProvider = {
    name: ProviderName.satisfies('test'),
    endpointConnections: [],
    createEndpointConnectionBindingPlan() {
      return {
        prepare: async () => ({
          resourceKeys: ['shared-resource'],
          persistedMetadata: {},
          create: async () => ({bind() {}, async dispose() {}}),
        }),
      };
    },
  };
  const bindings: readonly ProviderBindingRecord[] = [first, second].map(
    endpoint => ({
      endpoint: endpoint.path,
      endpointReference: endpoint.endpoint,
      deviceConstructors: [Light],
      metadata: {},
    }),
  );

  await expect(
    prepareMiotBindingResourceBindings(provider, bindings),
  ).rejects.toThrow(
    'Duplicate active MIoT provider resource binding: shared-resource',
  );
});

test('preserves equal existing bindings and proposes only missing endpoints', () => {
  const first = createCandidateEndpoint('', 2);
  const second = createCandidateEndpoint('accent', 3);
  const proposal = resolveMiotBindingDeviceProposal(
    createCandidate([first, second]),
    [createResourceBinding(first)],
  );

  expect(proposal.status).toBe('automatic');
  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'existing',
    'automatic',
  ]);
  expect(proposal.bindings).toEqual([
    {endpoint: second.endpoint.path, metadata: second.metadata},
  ]);
});

test('reports a completely existing mapping without resubmitting it', () => {
  const endpoint = createCandidateEndpoint('', 2);
  const proposal = resolveMiotBindingDeviceProposal(
    createCandidate([endpoint]),
    [createResourceBinding(endpoint)],
  );

  expect(proposal.status).toBe('existing');
  expect(proposal.endpoints.map(item => item.status)).toEqual(['existing']);
  expect(proposal.bindings).toEqual([]);
});

test('makes the whole physical mapping unavailable when one resource is used elsewhere', () => {
  const first = createCandidateEndpoint('', 2);
  const second = createCandidateEndpoint('accent', 3);
  const externalEndpoint = EndpointPath.satisfies({
    scopePath: ['other-home'],
    deviceName: 'other-device',
    endpointName: '',
  });
  const proposal = resolveMiotBindingDeviceProposal(
    createCandidate([first, second]),
    [createResourceBinding(second, externalEndpoint)],
  );

  expect(proposal.status).toBe('unavailable');
  expect(proposal.bindings).toEqual([]);
  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'unavailable',
    'unavailable',
  ]);
});

test('allows the complete mapping to replace resources held by its own endpoints', () => {
  const first = createCandidateEndpoint('', 2);
  const second = createCandidateEndpoint('accent', 3);
  const previousMetadata = createMetadata('previous.test.light');
  const device = createCandidate([
    {
      ...first,
      endpoint: {
        ...first.endpoint,
        binding: {
          endpoint: first.endpoint.path,
          provider: {namespace: 'xiaomi', name: ProviderName.satisfies('test')},
          metadata: previousMetadata,
        },
      },
    },
    {
      ...second,
      endpoint: {
        ...second.endpoint,
        binding: {
          endpoint: second.endpoint.path,
          provider: {namespace: 'xiaomi', name: ProviderName.satisfies('test')},
          metadata: previousMetadata,
        },
      },
    },
  ]);
  const proposal = resolveMiotBindingDeviceProposal(device, [
    {
      endpoint: first.endpoint.path,
      metadata: previousMetadata,
      resourceKeys: second.resourceKeys,
    },
    {
      endpoint: second.endpoint.path,
      metadata: previousMetadata,
      resourceKeys: first.resourceKeys,
    },
  ]);

  expect(proposal.status).toBe('automatic');
  expect(proposal.bindings).toHaveLength(2);
});

test('does not steal resources from another logical device using this provider', () => {
  const endpoint = createCandidateEndpoint('', 2);
  const unavailableEndpoint = {
    ...endpoint,
    endpoint: {
      ...endpoint.endpoint,
      binding: {
        endpoint: endpoint.endpoint.path,
        provider: {
          namespace: 'another',
          name: ProviderName.satisfies('test'),
        },
        metadata: undefined,
      },
    },
  };
  const proposal = resolveMiotBindingDeviceProposal(
    createCandidate([unavailableEndpoint]),
    [
      {
        endpoint: EndpointPath.satisfies({
          scopePath: ['other-home'],
          deviceName: 'other-device',
          endpointName: '',
        }),
        metadata: endpoint.metadata,
        resourceKeys: endpoint.resourceKeys,
      },
    ],
  );

  expect(proposal.status).toBe('unavailable');
  expect(proposal.bindings).toEqual([]);
});

function createDiscoveryProvider(
  devices: readonly {
    readonly did: string;
    readonly name?: string;
    readonly model?: string;
    readonly specType?: string;
  }[],
): MiotBindingDiscoveryProvider {
  return {
    configuration: {
      discoverDevices: async () => ({
        account: {cloudServer: 'cn' as const, userId: 'user'},
        homes: [],
        devices,
      }),
    },
  };
}

function createLogicalEndpoint(
  name: string,
  endpoint: LightEndpoint | FanEndpoint,
): ProviderBindingEndpoint {
  return {
    path: EndpointPath.satisfies({
      scopePath: ['home', 'room'],
      deviceName: 'logical device',
      endpointName: name,
    }),
    endpoint,
    binding: undefined,
  };
}

function createLogicalDevice(
  Device: typeof Light | typeof Fan,
  endpoints: readonly ProviderBindingEndpoint[],
): ProviderBindingDevice {
  return {
    name: 'logical device',
    deviceConstructors: [Device],
    endpoints,
  };
}

function createCandidate(
  endpoints: readonly MiotBindingEndpointCandidate[],
): MiotBindingDeviceCandidate {
  return {
    key: 'physical',
    device: {
      did: 'physical',
      model: 'test.light',
      specType: LIGHT_SPEC.type,
    },
    endpoints,
  };
}

function createCandidateEndpoint(
  name: string,
  serviceIid: number,
): MiotBindingEndpointCandidate {
  const metadata = createMetadata();
  const resolvedMetadata = createResolvedMetadata(metadata, serviceIid);

  return {
    endpoint: createLogicalEndpoint(name, new LightEndpoint(name)),
    metadata,
    resourceKeys: getMiotEndpointConnectionResourceKeys(resolvedMetadata),
    label: `Light ${serviceIid}`,
  };
}

function createMetadata(model = 'test.light'): MiotEndpointConnectionMetadata {
  return createMiotEndpointConnectionMetadata(
    {did: 'physical', model},
    LIGHT_SPEC,
  );
}

function createResolvedMetadata(
  metadata: MiotEndpointConnectionMetadata,
  serviceIid: number,
): MiotEndpointConnectionResolvedMetadata {
  const property = createOnProperty();
  const service: MiotSpecService = {
    iid: serviceIid,
    type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
    description: `Light ${serviceIid}`,
    properties: [property],
  };

  return createMiotEndpointConnectionResolvedMetadata(metadata, [
    {service, properties: {on: property}},
  ]);
}

function createResourceBinding(
  candidate: MiotBindingEndpointCandidate,
  endpoint: EndpointPath = candidate.endpoint.path,
): MiotBindingResourceBinding {
  return {
    endpoint,
    metadata: candidate.metadata,
    resourceKeys: candidate.resourceKeys,
  };
}

function createOnProperty(): MiotSpecProperty {
  return {
    iid: 1,
    type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
    description: 'Switch Status',
    format: 'bool',
    access: ['read', 'write', 'notify'],
  };
}

const LIGHT_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  description: 'Test Light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Main Light',
      properties: [createOnProperty()],
    },
  ],
};
