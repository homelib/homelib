import {type EndpointReference, Temperature} from '@homelib/core';

import type {MiotEndpointConnectionResolvedMetadata} from '../endpoint-connection.js';
import {MiotSetPropertyRequest, type MiotSpecProperty} from '../miot/index.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
} from './command-effect.js';

const BRIGHTNESS_PROPERTY = {
  iid: 2,
  type: 'urn:miot-spec-v2:property:brightness:0000000D:test:1',
  description: 'Brightness',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
  unit: 'percentage',
  'value-range': [20, 100, 5],
} as const satisfies MiotSpecProperty;
const TARGET_TEMPERATURE_PROPERTY = {
  iid: 3,
  type: 'urn:miot-spec-v2:property:target-temperature:00000021:test:1',
  description: 'Target Temperature',
  format: 'float',
  access: ['read', 'write', 'notify'],
  unit: 'celsius',
  'value-range': [16, 30, 0.5],
} as const satisfies MiotSpecProperty;
const LEVEL_PROPERTY = {
  iid: 4,
  type: 'urn:miot-spec-v2:property:target-distance:0000007E:test:1',
  description: 'Level',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
} as const satisfies MiotSpecProperty;
const UNSUPPORTED_PROPERTY = {
  iid: 5,
  type: 'urn:miot-spec-v2:property:custom:0000FFFF:test:1',
  description: 'Unsupported',
  format: 'custom',
  access: ['read', 'write', 'notify'],
} as const satisfies MiotSpecProperty;
const METADATA = {
  device: {
    did: 'device-1',
    model: 'test.device',
    urn: 'urn:miot-spec-v2:device:light:0000A001:test:1',
  },
  resources: [
    {
      service: {
        iid: 2,
        type: 'urn:miot-spec-v2:service:light:00007802:test:1',
        description: 'Light',
        properties: [
          BRIGHTNESS_PROPERTY,
          TARGET_TEMPERATURE_PROPERTY,
          LEVEL_PROPERTY,
          UNSUPPORTED_PROPERTY,
        ],
      },
      properties: {
        brightness: BRIGHTNESS_PROPERTY,
        targetTemperature: TARGET_TEMPERATURE_PROPERTY,
        level: LEVEL_PROPERTY,
        unsupported: UNSUPPORTED_PROPERTY,
      },
    },
  ],
} satisfies MiotEndpointConnectionResolvedMetadata;

test('uses resolved aliases and actual property ranges for requests', () => {
  const effect = new TestEffect({brightness: 0.23});

  expect(effect.request).toEqual(
    new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 2}, 25),
  );
});

test('compares canonical multi-property values without depending on map order', () => {
  const first = new TestEffect({
    brightness: 0.23,
    targetTemperature: Temperature.fromCelsius(23.24),
  });
  const second = new TestEffect({
    targetTemperature: Temperature.fromCelsius(23.2),
    brightness: 0.249,
  });
  const differentKeys = new TestEffect({brightness: 0.23});

  expect(first.equals(second)).toBe(true);
  expect(first.equals(differentKeys)).toBe(false);
  expect(() => first.request).toThrow(
    'A multi-property MIoT effect does not define one property request.',
  );
});

test('matches every targeted value against the same spec conventions', () => {
  const effect = new TestEffect({
    brightness: 0.23,
    targetTemperature: Temperature.fromCelsius(23.24),
  });
  const endpoint = new TestEndpoint();
  endpoint.brightness = 0.249;
  endpoint.targetTemperature = Temperature.fromCelsius(23.2);

  expect(effect.matches(endpoint)).toBe(true);

  endpoint.targetTemperature = Temperature.fromCelsius(23.26);
  expect(effect.matches(endpoint)).toBe(false);

  endpoint.brightness = undefined;
  expect(new TestEffect({brightness: 0.23}).matches(endpoint)).toBe(false);
});

test('rejects empty, undefined, and unknown effect values', () => {
  expect(() => new TestEffect({})).toThrow(
    'A MIoT command effect must contain a value.',
  );
  expect(() => new TestEffect({brightness: undefined})).toThrow(
    'MIoT command effect value is undefined: brightness.',
  );
  expect(
    () =>
      new TestEffect({
        unknown: true,
      } as unknown as MiotCommandEffectValues<TestEffectPropertyName>),
  ).toThrow('Unknown MIoT endpoint property: unknown.');
});

test('validates actual MIoT formats rather than accepting arbitrary numbers', () => {
  expect(() => new TestEffect({level: -1})).toThrow(
    'MIoT command effect value exceeds its format range.',
  );
  expect(() => new TestEffect({level: 256})).toThrow(
    'MIoT command effect value exceeds its format range.',
  );
  expect(() => new TestEffect({unsupported: 1})).toThrow(
    'Unsupported MIoT command effect format: custom.',
  );
});

test('tracks observations only for the targeted aliases', () => {
  const connection = new TestConnection();
  const brightnessEffect = new TestEffect({brightness: 0.5}, connection);
  const combinedEffect = new TestEffect(
    {
      brightness: 0.5,
      targetTemperature: Temperature.fromCelsius(24),
    },
    connection,
  );

  expect(brightnessEffect.observationRevision).toBe(0);
  expect(combinedEffect.observationRevision).toBe(0);

  connection.observe('targetTemperature');
  expect(brightnessEffect.observationRevision).toBe(0);
  expect(combinedEffect.observationRevision).toBe(0);

  connection.observe('brightness');
  expect(brightnessEffect.observationRevision).toBe(1);
  expect(combinedEffect.observationRevision).toBe(1);

  connection.observe('brightness');
  expect(brightnessEffect.observationRevision).toBe(2);
  expect(combinedEffect.observationRevision).toBe(1);

  connection.observe('targetTemperature');
  expect(combinedEffect.observationRevision).toBe(2);
});

type TestEffectPropertyName =
  'brightness' | 'targetTemperature' | 'level' | 'unsupported';

class TestEndpoint implements EndpointReference {
  readonly name = 'test';

  readonly ready = true;

  brightness: number | undefined;

  targetTemperature: Temperature | undefined;

  level: number | undefined;

  unsupported: number | undefined;
}

class TestEffect extends MiotCommandEffect<
  TestEndpoint,
  TestEffectPropertyName
> {
  constructor(
    values: MiotCommandEffectValues<TestEffectPropertyName>,
    connection: MiotCommandEffectConnection = new TestConnection(),
  ) {
    super(connection, values);
  }

  protected getValues(
    endpoint: TestEndpoint,
  ): MiotCommandEffectValues<TestEffectPropertyName> {
    return {
      brightness: endpoint.brightness,
      targetTemperature: endpoint.targetTemperature,
      level: endpoint.level,
      unsupported: endpoint.unsupported,
    };
  }
}

class TestConnection implements MiotCommandEffectConnection {
  readonly metadata = METADATA;

  private revision = 0;

  private readonly revisionMap = new Map<string, number>();

  getObservationRevision(names: Iterable<string>): number {
    let revision = 0;

    for (const name of names) {
      revision = Math.max(revision, this.revisionMap.get(name) ?? 0);
    }

    return revision;
  }

  observe(name: TestEffectPropertyName): void {
    this.revision++;
    this.revisionMap.set(name, this.revision);
  }
}
