import {
  EndpointPath,
  LightEndpoint,
  type ProviderBindingEndpoint,
} from '@homelib/core';

import {discoverMiotBindingDevices} from './binding.js';
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
