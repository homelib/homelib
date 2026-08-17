import {CommandError, type EndpointReference, Temperature} from '@homelib/core';

import {
  type MiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import {
  type MiotResolvedSpecProperty,
  MiotSetPropertyRequest,
  type MiotSpecProperty,
} from '../miot/index.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
  type MiotEncodedPropertyValue,
  type MiotPropertyValue,
  encodeMiotPropertyValue,
} from './command-effect.js';

const ON_PROPERTY = {
  iid: 1,
  type: 'urn:miot-spec-v2:property:on:00000006:test:1',
  description: 'On',
  format: 'bool',
  access: ['read', 'write', 'notify'],
} as const satisfies MiotSpecProperty;
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
const MODE_SPEC_PROPERTY = {
  iid: 5,
  type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
  description: 'Mode',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
  'value-list': [
    {value: 0, description: 'Other'},
    {value: 2, description: 'Cool'},
    {value: 5, description: 'Heat'},
  ],
} as const satisfies MiotSpecProperty;
const MODE_PROPERTY = {
  ...MODE_SPEC_PROPERTY,
} as const satisfies MiotResolvedSpecProperty;
const FAN_LEVEL_SPEC_PROPERTY = {
  iid: 8,
  type: 'urn:miot-spec-v2:property:fan-level:00000016:test:1',
  description: 'Fan Level',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
  'value-list': [
    {value: 0, description: 'Auto'},
    {value: 1, description: 'Level 1'},
    {value: 2, description: 'Level 2'},
    {value: 3, description: 'Level 3'},
    {value: 4, description: 'Level 4'},
    {value: 5, description: 'Level 5'},
    {value: 6, description: 'Level 6'},
    {value: 7, description: 'Level 7'},
    {value: 8, description: 'Level 8'},
  ],
} as const satisfies MiotSpecProperty;
const FAN_LEVEL_PROPERTY = {
  ...FAN_LEVEL_SPEC_PROPERTY,
} as const satisfies MiotResolvedSpecProperty;
const UNSUPPORTED_PROPERTY = {
  iid: 6,
  type: 'urn:miot-spec-v2:property:custom:0000FFFF:test:1',
  description: 'Unsupported',
  format: 'custom',
  access: ['read', 'write', 'notify'],
} as const satisfies MiotSpecProperty;
const READ_ONLY_PROPERTY = {
  iid: 7,
  type: 'urn:miot-spec-v2:property:custom-read-only:0000FFFE:test:1',
  description: 'Read Only',
  format: 'uint8',
  access: ['read', 'notify'],
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
          ON_PROPERTY,
          BRIGHTNESS_PROPERTY,
          TARGET_TEMPERATURE_PROPERTY,
          LEVEL_PROPERTY,
          MODE_SPEC_PROPERTY,
          FAN_LEVEL_SPEC_PROPERTY,
          UNSUPPORTED_PROPERTY,
          READ_ONLY_PROPERTY,
        ],
      },
      properties: {
        on: ON_PROPERTY,
        brightness: BRIGHTNESS_PROPERTY,
        targetTemperature: TARGET_TEMPERATURE_PROPERTY,
        level: LEVEL_PROPERTY,
        mode: MODE_PROPERTY,
        'fan-level': FAN_LEVEL_PROPERTY,
        unsupported: UNSUPPORTED_PROPERTY,
        readOnly: READ_ONLY_PROPERTY,
      },
    },
  ],
} satisfies MiotEndpointConnectionResolvedMetadata;

test('uses resolved aliases and actual property ranges for requests', () => {
  const effect = new TestEffect({brightness: encoded('brightness', 23)});

  expect(effect.request).toEqual(
    new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 2}, 25),
  );
});

test('compares canonical multi-property values without depending on map order', () => {
  const first = new TestEffect({
    brightness: encoded('brightness', 23),
    targetTemperature: encoded('targetTemperature', 23.24),
  });
  const second = new TestEffect({
    targetTemperature: encoded('targetTemperature', 23.2),
    brightness: encoded('brightness', 24.9),
  });
  const differentKeys = new TestEffect({
    brightness: encoded('brightness', 23),
  });

  expect(first.equals(second)).toBe(true);
  expect(first.equals(differentKeys)).toBe(false);
  expect(() => first.request).toThrow(
    'A multi-property MIoT effect does not define one property request.',
  );
});

test('matches every targeted value against the same spec conventions', () => {
  const connection = new TestConnection({
    brightness: 24,
    targetTemperature: 23.2,
  });
  const effect = new TestEffect(
    {
      brightness: encoded('brightness', 23),
      targetTemperature: encoded('targetTemperature', 23.24),
    },
    connection,
  );
  const endpoint = new TestEndpoint();

  expect(effect.matches(endpoint)).toBe(true);

  connection.setState('targetTemperature', 23.26);
  expect(effect.matches(endpoint)).toBe(false);

  connection.setState('brightness', undefined);
  expect(
    new TestEffect({brightness: encoded('brightness', 23)}, connection).matches(
      endpoint,
    ),
  ).toBe(false);
});

test('reads only the observed alias targeted by an on effect', () => {
  const connection = new TestConnection({on: true, mode: 6});
  const effect = new TestEffect({on: encoded('on', true)}, connection);

  expect(effect.matches(new ThrowingModeEndpoint())).toBe(true);
  expect(connection.readNames).toEqual(['on']);
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
  expect(() => new TestEffect({level: unvalidated(-1)})).toThrow(
    'MIoT property value exceeds its format range.',
  );
  expect(() => new TestEffect({level: unvalidated(256)})).toThrow(
    'MIoT property value exceeds its format range.',
  );
  expect(() => new TestEffect({unsupported: unvalidated(1)})).toThrow(
    'Unsupported MIoT property format: custom.',
  );
});

test('reports a non-writable resolved property as an unsupported command', () => {
  expect(
    () => new TestEffect({readOnly: encoded('readOnly', 1)}).request,
  ).toThrow(CommandError);
});

test('uses only canonical raw values for requests, equality, and matching', () => {
  const connection = new TestConnection({mode: 2});
  const effect = new TestEffect({mode: encoded('mode', 2)}, connection);
  const endpoint = new TestEndpoint();

  expect(effect.request).toEqual(
    new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 5}, 2),
  );
  expect(effect.equals(new TestEffect({mode: encoded('mode', 2)}))).toBe(true);
  expect(effect.equals(new TestEffect({mode: encoded('mode', 5)}))).toBe(false);

  expect(effect.matches(endpoint)).toBe(true);
  connection.setState('mode', 5);
  expect(effect.matches(endpoint)).toBe(false);
  connection.setState('mode', 0);
  expect(effect.matches(endpoint)).toBe(false);
  expect(() => new TestEffect({mode: unvalidated(3)})).toThrow(CommandError);
  expect(() => new TestEffect({mode: unvalidated('cool')})).toThrow(
    CommandError,
  );
});

test('does not interpret hybrid fan-level domain values', () => {
  const autoConnection = new TestConnection({'fan-level': 0});
  const autoEffect = new TestEffect(
    {'fan-level': encoded('fan-level', 0)},
    autoConnection,
    {'fan-level': 'auto'},
  );

  expect(autoEffect.request).toEqual(
    new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 8}, 0),
  );
  expect(autoEffect.toLogString()).toBe('set fan-level=0 (auto)');
  expect(autoEffect.matches(new TestEndpoint())).toBe(true);

  expect(
    new TestEffect({'fan-level': encoded('fan-level', 1)}).request,
  ).toEqual(new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 8}, 1));
  expect(
    new TestEffect({'fan-level': encoded('fan-level', 7)}).request,
  ).toEqual(new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 8}, 7));
  expect(
    new TestEffect({'fan-level': encoded('fan-level', 8)}).request,
  ).toEqual(new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 8}, 8));
  expect(() => new TestEffect({'fan-level': unvalidated('auto')})).toThrow(
    CommandError,
  );
  expect(() => new TestEffect({'fan-level': unvalidated(6 / 7)})).toThrow(
    CommandError,
  );

  const manualConnection = new TestConnection({'fan-level': 7});
  const manualEffect = new TestEffect(
    {'fan-level': encoded('fan-level', 7)},
    manualConnection,
  );

  expect(manualEffect.matches(new TestEndpoint())).toBe(true);
});

test('describes canonical raw values with caller-provided labels', () => {
  const effect = new TestEffect(
    {
      mode: encoded('mode', 2),
      targetTemperature: encoded('targetTemperature', 23.24),
      brightness: encoded('brightness', 23),
    },
    new TestConnection(),
    {mode: 'cool'},
  );

  expect(effect.toLogString()).toBe(
    'set brightness=25 set targetTemperature=23 set mode=2 (cool)',
  );
  expect(
    effect.equals(
      new TestEffect({
        mode: encoded('mode', 2),
        targetTemperature: encoded('targetTemperature', 23.24),
        brightness: encoded('brightness', 23),
      }),
    ),
  ).toBe(true);
  expect(
    () =>
      new TestEffect({mode: encoded('mode', 2)}, new TestConnection(), {
        brightness: 'high',
      }),
  ).toThrow(
    'MIoT command effect label has no corresponding value: brightness.',
  );
  expect(
    () =>
      new TestEffect({mode: encoded('mode', 2)}, new TestConnection(), {
        mode: '  ',
      }),
  ).toThrow('MIoT command effect label is empty: mode.');
});

test('defensively validates encoded values without domain unit conversion', () => {
  expect(new TestEffect({brightness: unvalidated(0.23)}).request).toEqual(
    new MiotSetPropertyRequest({did: 'device-1', siid: 2, piid: 2}, 20),
  );
  expect(
    () =>
      new TestEffect({
        targetTemperature: unvalidated(Temperature.fromCelsius(23)),
      }),
  ).toThrow('Invalid MIoT numeric property value.');
});

test('requires explicitly encoded effect values at compile time', () => {
  // @ts-expect-error -- A domain string has not been encoded for a property.
  const domainString: MiotCommandEffectValues<'mode'> = {mode: 'cool'};
  const normalizedValue: MiotCommandEffectValues<'fan-level'> = {
    // @ts-expect-error -- A normalized value has not been encoded for a property.
    'fan-level': 0.5,
  };
  // @ts-expect-error -- Even a raw-looking primitive must cross the encoder.
  const rawPrimitive: MiotCommandEffectValues<'mode'> = {mode: 2};

  void domainString;
  void normalizedValue;
  void rawPrimitive;
});

test('tracks observations only for the targeted aliases', () => {
  const connection = new TestConnection();
  const brightnessEffect = new TestEffect(
    {brightness: encoded('brightness', 50)},
    connection,
  );
  const combinedEffect = new TestEffect(
    {
      brightness: encoded('brightness', 50),
      targetTemperature: encoded('targetTemperature', 24),
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
  | 'on'
  | 'brightness'
  | 'targetTemperature'
  | 'level'
  | 'mode'
  | 'fan-level'
  | 'readOnly'
  | 'unsupported';

type TestStateValues = Readonly<
  Partial<Record<TestEffectPropertyName, MiotPropertyValue>>
>;

function encoded(
  name: TestEffectPropertyName,
  value: MiotPropertyValue,
): MiotEncodedPropertyValue {
  const {property} = getMiotEndpointConnectionProperty(METADATA, name);
  return encodeMiotPropertyValue(property, value);
}

function unvalidated(value: unknown): MiotEncodedPropertyValue {
  return value as MiotEncodedPropertyValue;
}

class TestEndpoint implements EndpointReference {
  readonly name = 'test';

  readonly ready = true;
}

class ThrowingModeEndpoint extends TestEndpoint {
  get mode(): never {
    throw new Error('Unrelated mode state was read.');
  }
}

class TestEffect extends MiotCommandEffect<TestEffectPropertyName> {
  constructor(
    values: MiotCommandEffectValues<TestEffectPropertyName>,
    connection: MiotCommandEffectConnection = new TestConnection(),
    labels: Readonly<Partial<Record<TestEffectPropertyName, string>>> = {},
  ) {
    super(connection, values, labels);
  }
}

class TestConnection implements MiotCommandEffectConnection {
  readonly metadata = METADATA;

  readonly readNames: string[] = [];

  private revision = 0;

  private readonly revisionMap = new Map<string, number>();

  private readonly stateMap = new Map<string, unknown>();

  constructor(states: TestStateValues = {}) {
    for (const [name, value] of Object.entries(states)) {
      if (value !== undefined) {
        this.stateMap.set(name, value);
      }
    }
  }

  getCommandEffectState(name: string): unknown {
    this.readNames.push(name);
    return this.stateMap.get(name);
  }

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

  setState(name: TestEffectPropertyName, value: unknown): void {
    if (value === undefined) {
      this.stateMap.delete(name);
    } else {
      this.stateMap.set(name, value);
    }
  }
}
