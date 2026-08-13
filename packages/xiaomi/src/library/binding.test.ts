import {
  EndpointPath,
  LightEndpoint,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
} from '@homelib/core';

import {
  type MiotBindingDeviceCandidate,
  type MiotBindingEndpointCandidate,
  type MiotBindingMatchCandidate,
  discoverMiotBindingDevices,
  resolveMiotBindingDeviceProposal,
} from './binding.js';
import {miotLightEndpointAdapter} from './devices/index.js';
import {
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {MiotSpecInstance} from './miot/index.js';

test('discovers physical devices and matches for a logical endpoint', async () => {
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
  expect(discovery.devices[0]?.endpoints[0]?.matches).toHaveLength(2);
  expect(
    discovery.devices[0]?.endpoints[0]?.matches[0]?.metadata,
  ).toMatchObject({
    device: {did: 'first', model: 'test.light', urn: LIGHT_SPEC.type},
    resources: [{service: {iid: 2}}],
  });
  expect(
    discovery.devices[0]?.endpoints[0]?.matches[0]?.metadata.resources[0],
  ).not.toHaveProperty('properties');
});

test('matches devices without a model when a spec type is available', async () => {
  const endpoint = createLogicalLightEndpoint();
  let getInstanceCallCount = 0;
  const provider = {
    configuration: {
      discoverDevices: async () => ({
        account: {cloudServer: 'cn' as const, userId: 'user'},
        homes: [],
        devices: [
          {
            did: 'without-model',
            name: 'model-less light',
            specType: LIGHT_SPEC.type,
          },
          {
            did: 'without-spec-type',
            name: 'incomplete light',
            model: 'test.light',
          },
        ],
      }),
    },
  };
  const discovery = await discoverMiotBindingDevices(provider, [endpoint], {
    getInstance: async () => {
      getInstanceCallCount++;
      return LIGHT_SPEC;
    },
  });
  const [device] = discovery.devices;
  const metadata = device?.endpoints[0]?.matches[0]?.metadata;

  expect(getInstanceCallCount).toBe(1);
  expect(discovery.failedDeviceCount).toBe(0);
  expect(discovery.incompleteDeviceCount).toBe(1);
  expect(discovery.devices).toHaveLength(1);
  expect(device?.device.did).toBe('without-model');
  expect(metadata?.device).toMatchObject({
    did: 'without-model',
    urn: LIGHT_SPEC.type,
  });
  expect(metadata?.device.model).toBeUndefined();

  if (metadata === undefined) {
    throw new Error('Model-less device has no MIoT match.');
  }

  expect(() =>
    miotLightEndpointAdapter.resolveMetadata(metadata),
  ).not.toThrow();
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
      getMiotEndpointConnectionResourceKeys(binding.metadata),
    ),
  ).toEqual([
    [JSON.stringify(['physical', 2])],
    [JSON.stringify(['physical', 3])],
  ]);
});

test('automatically resolves a unique assignment using every candidate resource', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [[2, 3]]);
  const secondEndpoint = createBindingEndpointCandidate('second', [3, 4]);
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
      getMiotEndpointConnectionResourceKeys(binding.metadata),
    ),
  ).toEqual([
    [JSON.stringify(['physical', 2]), JSON.stringify(['physical', 3])],
    [JSON.stringify(['physical', 4])],
  ]);
});

test('keeps set-valued assignments ambiguous when several maximum packings exist', () => {
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([
      createBindingEndpointCandidate('first', [[2, 3], 4]),
      createBindingEndpointCandidate('second', [3, 5]),
    ]),
    [],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'ambiguous',
    'ambiguous',
  ]);
  expect(proposal.bindings).toEqual([]);
});

test('ignores legacy property aliases when identifying an existing binding', () => {
  const currentMatch = createCurrentLightBindingMatchCandidate(2);
  const endpoint = createBindingEndpointCandidate('main', []);
  const device = createBindingDeviceCandidate([
    {...endpoint, matches: [currentMatch]},
  ]);
  const validProposal = resolveMiotBindingDeviceProposal(device, [
    {
      endpoint: endpoint.endpoint.path,
      metadata: currentMatch.metadata,
    },
  ]);
  const currentResource = currentMatch.metadata.resources.at(0);

  if (currentResource === undefined) {
    throw new Error('Current test binding has no resource.');
  }
  const [on] = currentResource.service.properties ?? [];

  if (on === undefined) {
    throw new Error('Current test binding has no physical property.');
  }

  const oldMetadata = {
    ...currentMatch.metadata,
    resources: [
      {
        ...currentResource,
        properties: {staleAlias: on},
      },
    ],
  };
  const oldProposal = resolveMiotBindingDeviceProposal(device, [
    {endpoint: endpoint.endpoint.path, metadata: oldMetadata},
  ]);

  expect(validProposal.endpoints.map(item => item.status)).toEqual([
    'existing',
  ]);
  expect(oldProposal.endpoints.map(item => item.status)).toEqual(['existing']);
  expect(oldProposal.bindings).toEqual([]);
});

test('does not silently choose a contested single match', () => {
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
  const occupiedMatch = createBindingMatchCandidate(2);
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
        metadata: occupiedMatch.metadata,
      },
    ],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'missing',
    'unavailable',
  ]);
});

test('legacy property aliases do not hide occupied physical resources', () => {
  const occupiedMatch = createBindingMatchCandidate(2);
  const [resource] = occupiedMatch.metadata.resources;

  if (resource === undefined) {
    throw new Error('Occupied test binding has no resource.');
  }

  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([
      createBindingEndpointCandidate('occupied', [2]),
    ]),
    [
      {
        endpoint: EndpointPath.satisfies({
          scopePath: ['another home'],
          deviceName: 'another light',
          endpointName: '',
        }),
        metadata: {
          ...occupiedMatch.metadata,
          resources: [{...resource, properties: {obsolete: {iid: 999}}}],
        },
      },
    ],
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'unavailable',
  ]);
});

test('treats a candidate as occupied when any of its resources is bound', () => {
  const endpoint = createBindingEndpointCandidate('multi-resource', [[2, 3]]);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([endpoint]),
    [
      {
        endpoint: EndpointPath.satisfies({
          scopePath: ['another home'],
          deviceName: 'another device',
          endpointName: '',
        }),
        metadata: createBindingMatchCandidate(3).metadata,
      },
    ],
  );

  expect(proposal.endpoints.map(item => item.status)).toEqual(['unavailable']);
  expect(proposal.bindings).toEqual([]);
});

test('does not identify existing metadata by resource keys alone', () => {
  const match = createCurrentLightBindingMatchCandidate(2);
  const endpoint = createBindingEndpointCandidate('main', []);
  const device = createBindingDeviceCandidate([
    {...endpoint, matches: [match]},
  ]);
  const metadataWithDifferentIdentity =
    MiotEndpointConnectionMetadata.satisfies({
      ...match.metadata,
      device: {...match.metadata.device, model: 'other.light'},
    });
  const proposal = resolveMiotBindingDeviceProposal(device, [
    {endpoint: endpoint.endpoint.path, metadata: metadataWithDifferentIdentity},
  ]);

  expect(proposal.endpoints.map(item => item.status)).toEqual(['automatic']);
  expect(proposal.bindings).toEqual([
    {endpoint: endpoint.endpoint.path, metadata: match.metadata},
  ]);
});

test('identifies semantically equal reordered metadata as existing', () => {
  const match = createCurrentLightBindingMatchCandidate(2);
  const endpoint = createBindingEndpointCandidate('main', []);
  const device = createBindingDeviceCandidate([
    {...endpoint, matches: [match]},
  ]);
  const [resource] = match.metadata.resources;

  if (resource?.service.properties === undefined) {
    throw new Error('Current test binding has no service properties.');
  }

  const reorderedMetadata = MiotEndpointConnectionMetadata.satisfies({
    ...match.metadata,
    resources: [
      {
        ...resource,
        service: {
          ...resource.service,
          properties: [...resource.service.properties]
            .reverse()
            .map(property => ({
              ...property,
              access: [...property.access].reverse(),
            })),
        },
      },
    ],
  });
  const proposal = resolveMiotBindingDeviceProposal(device, [
    {endpoint: endpoint.endpoint.path, metadata: reorderedMetadata},
  ]);

  expect(proposal.endpoints.map(item => item.status)).toEqual(['existing']);
  expect(proposal.bindings).toEqual([]);
});

test('atomically swaps resources between existing endpoint bindings', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [2, 3]);
  const secondEndpoint = createBindingEndpointCandidate('second', [2, 3]);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([firstEndpoint, secondEndpoint]),
    [
      {
        endpoint: firstEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate(2).metadata,
      },
      {
        endpoint: secondEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate(3).metadata,
      },
    ],
    {
      [getEndpointPathKey(firstEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-3',
      },
      [getEndpointPathKey(secondEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-2',
      },
    },
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'manual',
    'manual',
  ]);
  expect(
    proposal.bindings.map(binding =>
      getMiotEndpointConnectionResourceKeys(binding.metadata),
    ),
  ).toEqual([
    [JSON.stringify(['physical', 3])],
    [JSON.stringify(['physical', 2])],
  ]);
});

test('reuses a resource released by a valid manual replacement', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [2, 4]);
  const secondEndpoint = createBindingEndpointCandidate('second', [2]);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([firstEndpoint, secondEndpoint]),
    [
      {
        endpoint: firstEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate(2).metadata,
      },
    ],
    {
      [getEndpointPathKey(firstEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-4',
      },
    },
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'manual',
    'automatic',
  ]);
  expect(proposal.bindings).toHaveLength(2);
});

test('atomically swaps multi-resource endpoint bindings', () => {
  const firstEndpoint = createBindingEndpointCandidate('first', [
    [2, 3],
    [4, 5],
  ]);
  const secondEndpoint = createBindingEndpointCandidate('second', [
    [2, 3],
    [4, 5],
  ]);
  const proposal = resolveMiotBindingDeviceProposal(
    createBindingDeviceCandidate([firstEndpoint, secondEndpoint]),
    [
      {
        endpoint: firstEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate([2, 3]).metadata,
      },
      {
        endpoint: secondEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate([4, 5]).metadata,
      },
    ],
    {
      [getEndpointPathKey(firstEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-4-5',
      },
      [getEndpointPathKey(secondEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-2-3',
      },
    },
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'manual',
    'manual',
  ]);
  expect(proposal.bindings).toHaveLength(2);
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
        metadata: createBindingMatchCandidate(2).metadata,
      },
      {
        endpoint: secondEndpoint.endpoint.path,
        metadata: createBindingMatchCandidate(3).metadata,
      },
    ],
    {
      [getEndpointPathKey(firstEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-4',
      },
      [getEndpointPathKey(secondEndpoint.endpoint.path)]: {
        type: 'match',
        matchKey: 'match-4',
      },
    },
  );

  expect(proposal.endpoints.map(endpoint => endpoint.status)).toEqual([
    'unavailable',
    'unavailable',
    'unavailable',
  ]);
  expect(proposal.bindings).toHaveLength(0);
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
  resourceServiceIds: readonly (number | readonly number[])[],
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
    matches: resourceServiceIds.map(createBindingMatchCandidate),
  };
}

function createBindingMatchCandidate(
  serviceIdOrIds: number | readonly number[],
): MiotBindingMatchCandidate {
  const serviceIds =
    typeof serviceIdOrIds === 'number' ? [serviceIdOrIds] : serviceIdOrIds;
  const [serviceId] = serviceIds;

  if (serviceId === undefined) {
    throw new TypeError('Test binding candidate requires a resource.');
  }

  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {did: 'physical', model: 'test.light', urn: LIGHT_SPEC.type},
    resources: serviceIds.map((resourceServiceId, index) => {
      const property = {
        iid: 1,
        type: `urn:miot-spec-v2:property:${index === 0 ? 'on' : `state-${resourceServiceId}`}:00000006:test-light:1`,
        description:
          index === 0 ? 'Switch Status' : `State ${resourceServiceId}`,
        format: 'bool',
        access: index === 0 ? ['read', 'write', 'notify'] : ['read', 'notify'],
      };

      return {
        service: {
          iid: resourceServiceId,
          type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
          description: `Light ${resourceServiceId}`,
          properties: [property],
        },
      };
    }),
  });

  return {
    key: `match-${serviceIds.join('-')}`,
    resourceKeys: getMiotEndpointConnectionResourceKeys(metadata),
    label: `Light ${serviceId}`,
    metadata,
  };
}

function createCurrentLightBindingMatchCandidate(
  serviceId: number,
): MiotBindingMatchCandidate {
  const on = {
    iid: 1,
    type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
    description: 'Switch Status',
    format: 'bool',
    access: ['read', 'write', 'notify'],
  };
  const brightness = {
    iid: 2,
    type: 'urn:miot-spec-v2:property:brightness:0000000D:test-light:1',
    description: 'Brightness',
    format: 'uint8',
    access: ['read', 'write', 'notify'],
    unit: 'percentage',
    'value-range': [1, 100, 1],
  };
  const colorTemperature = {
    iid: 3,
    type: 'urn:miot-spec-v2:property:color-temperature:0000000F:test-light:1',
    description: 'Color Temperature',
    format: 'uint32',
    access: ['read', 'write', 'notify'],
    unit: 'kelvin',
    'value-range': [2700, 6500, 1],
  };
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {did: 'physical', model: 'test.light', urn: LIGHT_SPEC.type},
    resources: [
      {
        service: {
          iid: serviceId,
          type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
          description: `Light ${serviceId}`,
          properties: [on, brightness, colorTemperature],
        },
      },
    ],
  });

  return {
    key: `current-light-match-${serviceId}`,
    resourceKeys: getMiotEndpointConnectionResourceKeys(metadata),
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
