import {
  EndpointPath,
  LightEndpoint,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
} from '@homelib/core';

import {
  type MiotBindingDeviceCandidate,
  type MiotBindingEndpointCandidate,
  type MiotBindingServiceCandidate,
  discoverMiotBindingDevices,
  resolveMiotBindingDeviceProposal,
} from './binding.js';
import {
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKey,
} from './endpoint-connection.js';
import type {MiotSpecInstance} from './miot/index.js';

test('discovers physical devices and matching services for a logical endpoint', async () => {
  const endpoint: ProviderBindingEndpoint = {
    path: EndpointPath.satisfies({
      scopePath: ['home', 'room'],
      deviceName: 'light',
      endpointName: '',
    }),
    endpoint: new LightEndpoint(),
    binding: undefined,
  };
  let getInstanceCallCount = 0;
  const getInstance = async (): Promise<MiotSpecInstance> => {
    getInstanceCallCount++;
    return LIGHT_SPEC;
  };
  const provider = {
    configuration: {
      discoverDevices: async () => ({
        account: {cloudServer: 'cn' as const, userId: 'user'},
        homes: [],
        devices: [
          {
            did: 'first',
            name: 'first light',
            model: 'test.light',
            specType: LIGHT_SPEC.type,
          },
          {
            did: 'second',
            name: 'second light',
            model: 'test.light',
            specType: LIGHT_SPEC.type,
          },
        ],
      }),
    },
  };

  const discovery = await discoverMiotBindingDevices(provider, [endpoint], {
    getInstance,
  });

  expect(getInstanceCallCount).toBe(1);
  expect(discovery.devices).toHaveLength(2);
  expect(discovery.devices[0]?.endpoints[0]?.services).toHaveLength(2);
  expect(
    discovery.devices[0]?.endpoints[0]?.services[0]?.metadata,
  ).toMatchObject({
    device: {did: 'first', model: 'test.light', urn: LIGHT_SPEC.type},
    service: {iid: 2},
    properties: {on: {iid: 1}},
  });
});

test('distinguishes missing authorization from no compatible devices', async () => {
  const provider = {
    configuration: {discoverDevices: async () => undefined},
  };

  await expect(discoverMiotBindingDevices(provider, [])).rejects.toThrow(
    'configure this miot provider before binding devices.',
  );
});

test('limits concurrent MIoT spec requests', async () => {
  const endpoint = createLogicalLightEndpoint();
  let activeRequestCount = 0;
  let maximumActiveRequestCount = 0;
  let requestCount = 0;
  const devices = Array.from({length: 14}, (_value, index) => ({
    did: `device-${index}`,
    model: 'test.light',
    specType: `${LIGHT_SPEC.type}:${index}`,
  }));
  const provider = {
    configuration: {
      discoverDevices: async () => ({
        account: {cloudServer: 'cn' as const, userId: 'user'},
        homes: [],
        devices,
      }),
    },
  };
  const getInstance = async (urn: string): Promise<MiotSpecInstance> => {
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
  };

  const discovery = await discoverMiotBindingDevices(provider, [endpoint], {
    getInstance,
  });

  expect(requestCount).toBe(14);
  expect(maximumActiveRequestCount).toBe(6);
  expect(discovery.devices).toHaveLength(14);
});

test('reuses the default MIoT spec client across discovery reloads', async () => {
  const originalFetch = globalThis.fetch;
  const endpoint = createLogicalLightEndpoint();
  const spec = {
    ...LIGHT_SPEC,
    type: 'urn:miot-spec-v2:device:light:0000A001:binding-cache-test:1',
  };
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount++;
    return new Response(JSON.stringify(spec));
  };

  try {
    const provider = {
      configuration: {
        discoverDevices: async () => ({
          account: {cloudServer: 'cn' as const, userId: 'user'},
          homes: [],
          devices: [
            {
              did: 'cached-device',
              model: 'test.light',
              specType: spec.type,
            },
          ],
        }),
      },
    };

    await discoverMiotBindingDevices(provider, [endpoint]);
    await discoverMiotBindingDevices(provider, [endpoint]);

    expect(fetchCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatically resolves the unique whole-device assignment', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [2]);
  const secondEndpoint = createBindingEndpointCandidate('second', [2, 3]);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([firstEndpoint, secondEndpoint]),
    [],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'automatic',
    'automatic',
  ]);
  expect(
    proposal.bindings.map(binding =>
      getMiotEndpointConnectionResourceKey(binding.metadata),
    ),
  ).toEqual([JSON.stringify(['physical', 2]), JSON.stringify(['physical', 3])]);
});

test('does not silently choose a shared single service', () => {
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([
      createBindingEndpointCandidate('first', [2]),
      createBindingEndpointCandidate('second', [2]),
    ]),
    [],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'ambiguous',
    'ambiguous',
  ]);
  expect(proposal.bindings).toEqual([]);
});

test('keeps missing and occupied endpoints visible in the proposal', () => {
  const occupiedService = createBindingServiceCandidate(2);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([
      createBindingEndpointCandidate('missing', []),
      createBindingEndpointCandidate('occupied', [2]),
    ]),
    [
      {
        endpoint: EndpointPath.satisfies({
          scopePath: ['another home'],
          deviceName: 'another light',
          endpointName: '',
        }),
        metadata: occupiedService.metadata,
      },
    ],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'missing',
    'unavailable',
  ]);
});

test('does not release a binding whose replacement cannot be submitted', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [2, 4]);
  const secondEndpoint = createBindingEndpointCandidate('second', [3, 4]);
  const thirdEndpoint = createBindingEndpointCandidate('third', [3]);
  const device = createBindingDeviceCandidate([
    firstEndpoint,
    secondEndpoint,
    thirdEndpoint,
  ]);
  const proposal = resolveMiotBindingDeviceProposal(
    device,
    [
      {
        endpoint: firstEndpoint.endpoint.path,
        metadata: createBindingServiceCandidate(2).metadata,
      },
      {
        endpoint: secondEndpoint.endpoint.path,
        metadata: createBindingServiceCandidate(3).metadata,
      },
    ],
    {
      [getEndpointPathKey(firstEndpoint.endpoint.path)]: {
        type: 'service',
        serviceKey: 'service-4',
      },
      [getEndpointPathKey(secondEndpoint.endpoint.path)]: {
        type: 'service',
        serviceKey: 'service-4',
      },
    },
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'manual',
    'unavailable',
    'unavailable',
  ]);
  expect(proposal.bindings).toHaveLength(1);
});

function createLogicalLightEndpoint(): ProviderBindingEndpoint {
  return {
    path: EndpointPath.satisfies({
      scopePath: ['home', 'room'],
      deviceName: 'light',
      endpointName: '',
    }),
    endpoint: new LightEndpoint(),
    binding: undefined,
  };
}

function createBindingDeviceCandidate(
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

function createBindingEndpointCandidate(
  name: string,
  serviceIds: readonly number[],
): MiotBindingEndpointCandidate {
  return {
    endpoint: {
      path: EndpointPath.satisfies({
        scopePath: ['home'],
        deviceName: 'logical light',
        endpointName: name,
      }),
      endpoint: new LightEndpoint(name),
      binding: undefined,
    },
    services: serviceIds.map(createBindingServiceCandidate),
  };
}

function createBindingServiceCandidate(
  serviceId: number,
): MiotBindingServiceCandidate {
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {did: 'physical', model: 'test.light', urn: LIGHT_SPEC.type},
    service: {
      iid: serviceId,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: `Light ${serviceId}`,
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
    properties: {
      on: {
        iid: 1,
        type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
        description: 'Switch Status',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    },
  });

  return {
    key: `service-${serviceId}`,
    resourceKey: getMiotEndpointConnectionResourceKey(metadata),
    label: `Light ${serviceId}`,
    metadata,
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
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
    {
      iid: 3,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Ambient Light',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
  ],
};
