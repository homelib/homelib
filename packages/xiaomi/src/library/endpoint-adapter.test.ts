import {
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
} from '@homelib/core';

import {
  type MiotEndpointAdapter,
  MiotEndpointAdapterRegistry,
  defineMiotEndpointAdapter,
} from './endpoint-adapter.js';
import {
  MiotEndpointConnection,
  type MiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import type {MiotEndpointMatcher, MiotSpecInstance} from './miot/index.js';

const ON_MATCHER = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
} as const satisfies MiotEndpointMatcher;

const ALIAS_MATCHER = {
  ...ON_MATCHER,
  properties: {alias: ON_MATCHER.properties.on},
} as const satisfies MiotEndpointMatcher;

test('deduplicates identical matcher results with a stable candidate key', () => {
  const adapter = createTestAdapter('test', [ON_MATCHER, ON_MATCHER]);

  expect(adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC)).toEqual([
    {
      key: JSON.stringify(['test', 'physical', 2, [['on', 1]]]),
      label: 'Light',
      metadata: expect.objectContaining({
        device: expect.objectContaining({did: 'physical'}),
        service: expect.objectContaining({iid: 2}),
        properties: {on: expect.objectContaining({iid: 1})},
      }),
    },
  ]);
});

test('rejects different metadata mappings for one physical service', () => {
  const adapter = createTestAdapter('test', [ON_MATCHER, ALIAS_MATCHER]);

  expect(() => adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC)).toThrow(
    'Ambiguous MIoT test endpoint metadata for one service.',
  );
});

test('rejects duplicate endpoint constructors in a registry', () => {
  const firstAdapter = createTestAdapter('first', [ON_MATCHER]);
  const secondAdapter = createTestAdapter('second', [ON_MATCHER]);

  expect(
    () => new MiotEndpointAdapterRegistry([firstAdapter, secondAdapter]),
  ).toThrow('Duplicate MIoT endpoint adapter Endpoint.');
});

test('rejects duplicate adapter types in a registry', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const firstAdapter = createTestAdapter('light', [ON_MATCHER]);
  const secondAdapter = createTestAdapter(
    'light',
    [ON_MATCHER],
    SpecializedLightEndpoint,
  );

  expect(
    () => new MiotEndpointAdapterRegistry([firstAdapter, secondAdapter]),
  ).toThrow('Duplicate MIoT endpoint adapter: light.');
});

test('looks up adapters by exact endpoint constructor', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const adapter = createTestAdapter('light', [ON_MATCHER]);
  const registry = new MiotEndpointAdapterRegistry([adapter]);

  expect(registry.get(new LightEndpoint())).toBe(adapter);
  expect(registry.get(new SpecializedLightEndpoint())).toBeUndefined();
});

function createTestAdapter(
  type: string,
  endpointMatchers: readonly MiotEndpointMatcher[],
  Endpoint: new (
    name?: string,
  ) => LightEndpoint<LightEndpointConnection> = LightEndpoint,
): MiotEndpointAdapter {
  return defineMiotEndpointAdapter<
    LightEndpointCommand,
    LightEndpointConnection
  >({
    type,
    Endpoint,
    Connection: TestLightEndpointConnection,
    endpointMatchers,
  });
}

class TestLightEndpointConnection
  extends MiotEndpointConnection<LightEndpointCommand>
  implements LightEndpointConnection
{
  get on(): boolean | undefined {
    return undefined;
  }

  static assertMetadata(_metadata: MiotEndpointConnectionMetadata): void {}

  override processCommand(_command: LightEndpointCommand): Promise<void> {
    return Promise.resolve();
  }
}

const TEST_DEVICE = {did: 'physical', model: 'test.light'};

const TEST_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  description: 'Test light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Light',
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
