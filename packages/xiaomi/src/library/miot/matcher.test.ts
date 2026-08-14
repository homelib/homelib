import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  type MiotPropertySchemaResource,
  isValidMiotSpecValueList,
  isValidMiotSpecValueRange,
  matchesMiotUrnPattern,
  resolveMiotPropertySchema,
} from './matcher.js';
import type {
  MiotSpecProperty,
  MiotSpecService,
  MiotSpecValueList,
  MiotSpecValueRange,
} from './spec.js';

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

const LIGHT_SERVICE_TYPE = 'urn:miot-spec-v2:service:light:00007802';
const ENVIRONMENT_SERVICE_TYPE =
  'urn:miot-spec-v2:service:environment:0000780A';
const ON_PROPERTY_TYPE = 'urn:miot-spec-v2:property:on:00000006';
const BRIGHTNESS_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:brightness:0000000D';
const MODE_PROPERTY_TYPE = 'urn:miot-spec-v2:property:mode:00000008';
const TEMPERATURE_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:temperature:00000020';
const RELATIVE_HUMIDITY_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:relative-humidity:0000000C';
const TEST_DEVICE_TYPE = 'urn:miot-spec-v2:device:light:0000A001:test-light:1';
const ZHIMI_FAN_DEVICE_TYPE =
  'urn:miot-spec-v2:device:fan:0000A005:zhimi-fa1:1';
const ZHIMI_FAN_DEVICE_PATTERN =
  'urn:miot-spec-v2:device:fan:0000A005:zhimi-fa1';
const ZHIMI_FAN_FAMILY_PATTERN = 'urn:miot-spec-v2:device:fan:0000A005:zhimi-*';
const DMAKER_FAN_FAMILY_PATTERN =
  'urn:miot-spec-v2:device:fan:0000A005:dmaker-*';

const LIGHT_SCHEMA = {
  [LIGHT_SERVICE_TYPE]: {
    [ON_PROPERTY_TYPE]: 'on',
  },
} as const satisfies MiotPropertySchema;

const DIMMABLE_LIGHT_SCHEMA = {
  [LIGHT_SERVICE_TYPE]: {
    [ON_PROPERTY_TYPE]: 'on',
    [BRIGHTNESS_PROPERTY_TYPE]: {name: 'brightness', optional: true},
  },
} as const satisfies MiotPropertySchema;

const FAN_MODE_ENUM = {
  '*': {normal: 0, natural: 1},
} as const;

const FAN_SCHEMA = {
  [LIGHT_SERVICE_TYPE]: {
    [ON_PROPERTY_TYPE]: 'on',
    [MODE_PROPERTY_TYPE]: {
      name: 'mode',
      enum: FAN_MODE_ENUM,
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

const ENVIRONMENT_SCHEMA = {
  [ENVIRONMENT_SERVICE_TYPE]: {
    [TEMPERATURE_PROPERTY_TYPE]: {name: 'temperature', optional: true},
    [RELATIVE_HUMIDITY_PROPERTY_TYPE]: {
      name: 'relativeHumidity',
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

describe('matchesMiotUrnPattern', () => {
  const deviceType = 'urn:miot-spec-v2:device:fan:0000A005:zhimi-fa1:1';

  test('matches an exact URN', () => {
    expect(matchesMiotUrnPattern(deviceType, deviceType)).toBe(true);
  });

  test('matches a base URN at a segment boundary', () => {
    expect(
      matchesMiotUrnPattern(deviceType, 'urn:miot-spec-v2:device:fan:0000A005'),
    ).toBe(true);
  });

  test('does not end a match inside a segment', () => {
    expect(
      matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:fan:0000A005:zhimi-fa',
      ),
    ).toBe(false);
  });

  test('supports a wildcard within a segment', () => {
    expect(
      matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:fan:0000A005:zhimi-*',
      ),
    ).toBe(true);
  });

  test('does not allow a wildcard to cross a colon', () => {
    expect(
      matchesMiotUrnPattern(deviceType, 'urn:miot-spec-v2:device:*:zhimi-*'),
    ).toBe(false);
  });

  test('requires a wildcard to match at least one character', () => {
    expect(
      matchesMiotUrnPattern(
        'urn:miot-spec-v2:device:',
        'urn:miot-spec-v2:device:*',
      ),
    ).toBe(false);
  });

  test('does not start matching in the middle of a URN', () => {
    expect(matchesMiotUrnPattern(deviceType, 'device:fan:*')).toBe(false);
  });

  test('supports a global wildcard fallback', () => {
    expect(matchesMiotUrnPattern(deviceType, '*')).toBe(true);
  });
});

test('treats a string property mapping as required', () => {
  expect(resolveTestSchema([createLightService()], LIGHT_SCHEMA)).toMatchObject(
    [{service: {iid: 2}, properties: {on: {iid: 1}}}],
  );

  expect(
    resolveTestSchema([createLightService({properties: []})], LIGHT_SCHEMA),
  ).toBeUndefined();
  expect(resolveTestSchema([], LIGHT_SCHEMA)).toBeUndefined();
});

test('treats an object property mapping as required by default', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [ON_PROPERTY_TYPE]: {name: 'on'},
    },
  } as const satisfies MiotPropertySchema;

  expect(resolveTestSchema([createLightService()], schema)).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}}},
  ]);
  expect(
    resolveTestSchema([createLightService({properties: []})], schema),
  ).toBeUndefined();
});

test('matches service and property types with vendor suffixes', () => {
  const [resource] =
    resolveTestSchema(
      [
        createLightService({
          type: `${LIGHT_SERVICE_TYPE}:vendor:1`,
          properties: [
            createProperty(1, `${ON_PROPERTY_TYPE}:vendor:1`, {
              format: 'vendor-bool',
              access: ['read', 'notify'],
              unit: 'vendor-unit',
            }),
          ],
        }),
      ],
      LIGHT_SCHEMA,
    ) ?? [];

  expect(resource?.service.iid).toBe(2);
  expect(resource?.properties.on).toMatchObject({
    iid: 1,
    format: 'vendor-bool',
    access: ['read', 'notify'],
    unit: 'vendor-unit',
  });
});

test.each([
  ['read', ['notify']],
  ['notify', ['read']],
] as const)(
  'requires the %s access mode for a required state property',
  (_missingAccess, access) => {
    const service = createLightService({
      properties: [createProperty(1, ON_PROPERTY_TYPE, {access: [...access]})],
    });

    expect(resolveTestSchema([service], LIGHT_SCHEMA)).toBeUndefined();
  },
);

test('omits an optional property that cannot provide observable state', () => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, BRIGHTNESS_PROPERTY_TYPE, {access: ['read']}),
    ],
  });
  const [resource] = resolveTestSchema([service], DIMMABLE_LIGHT_SCHEMA) ?? [];

  expect(resource?.properties.on?.iid).toBe(1);
  expect(resource?.properties.brightness).toBeUndefined();
});

test('requires both the declared service and required property types', () => {
  const wrongService = createLightService({
    type: 'urn:miot-spec-v2:service:other:00007FFF:test:1',
  });
  const wrongProperty = createLightService({
    properties: [
      createProperty(1, 'urn:miot-spec-v2:property:other:0000FFFF:test:1'),
    ],
  });

  expect(resolveTestSchema([wrongService], LIGHT_SCHEMA)).toBeUndefined();
  expect(resolveTestSchema([wrongProperty], LIGHT_SCHEMA)).toBeUndefined();
});

test('includes a unique optional property and omits a missing one', () => {
  const withBrightness = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, BRIGHTNESS_PROPERTY_TYPE, {
        format: 'uint16',
        unit: 'percentage',
        'value-range': [1, 100, 1],
      }),
    ],
  });
  const [complete] =
    resolveTestSchema([withBrightness], DIMMABLE_LIGHT_SCHEMA) ?? [];
  const [basic] =
    resolveTestSchema([createLightService()], DIMMABLE_LIGHT_SCHEMA) ?? [];

  expect(complete?.properties).toMatchObject({
    on: {iid: 1},
    brightness: {iid: 2, format: 'uint16', 'value-range': [1, 100, 1]},
  });
  expect(basic?.properties.on?.iid).toBe(1);
  expect(basic?.properties.brightness).toBeUndefined();
  expect(Object.hasOwn(basic?.properties ?? {}, 'brightness')).toBe(false);
});

test('rejects an ambiguous required property', () => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, `${ON_PROPERTY_TYPE}:vendor:2`),
    ],
  });

  expect(resolveTestSchema([service], LIGHT_SCHEMA)).toBeUndefined();
});

test('omits an ambiguous optional property without rejecting the service', () => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, BRIGHTNESS_PROPERTY_TYPE),
      createProperty(3, `${BRIGHTNESS_PROPERTY_TYPE}:vendor:2`),
    ],
  });
  const [resource] = resolveTestSchema([service], DIMMABLE_LIGHT_SCHEMA) ?? [];

  expect(resource?.properties.on?.iid).toBe(1);
  expect(resource?.properties.brightness).toBeUndefined();
});

test.each(['optional-first', 'required-first'] as const)(
  'does not map one property to two aliases (%s)',
  order => {
    const vendorOnType = `${ON_PROPERTY_TYPE}:vendor:1`;
    const optional = {
      [ON_PROPERTY_TYPE]: {name: 'optionalOn', optional: true},
    } as const;
    const required = {[vendorOnType]: 'on'} as const;
    const schema = {
      [LIGHT_SERVICE_TYPE]:
        order === 'optional-first'
          ? {...optional, ...required}
          : {...required, ...optional},
    } as const satisfies MiotPropertySchema;
    const [resource] =
      resolveTestSchema(
        [
          createLightService({
            properties: [createProperty(1, vendorOnType)],
          }),
        ],
        schema,
      ) ?? [];

    expect(resource?.properties).toEqual({
      on: expect.objectContaining({iid: 1}),
    });
  },
);

test('rejects multiple services satisfying required properties', () => {
  expect(
    resolveTestSchema(
      [createLightService(), createLightService({iid: 3})],
      LIGHT_SCHEMA,
    ),
  ).toBeUndefined();
});

test('allows a service containing only optional properties to be absent', () => {
  expect(resolveTestSchema([], ENVIRONMENT_SCHEMA)).toEqual([]);
  expect(
    resolveTestSchema([createEnvironmentService(4, [])], ENVIRONMENT_SCHEMA),
  ).toEqual([]);

  expect(
    resolveTestSchema(
      [
        createEnvironmentService(4, [
          createProperty(1, TEMPERATURE_PROPERTY_TYPE),
        ]),
      ],
      ENVIRONMENT_SCHEMA,
    ),
  ).toMatchObject([{service: {iid: 4}, properties: {temperature: {iid: 1}}}]);
});

test('rejects multiple matching optional services by default', () => {
  const services = createSplitEnvironmentServices();

  expect(resolveTestSchema(services, ENVIRONMENT_SCHEMA)).toBeUndefined();
});

test('allows multiple optional services when explicitly requested', () => {
  const resources = resolveTestSchema(
    createSplitEnvironmentServices(),
    ENVIRONMENT_SCHEMA,
    {allowMultipleOptionalServices: true},
  );

  expect(resources).toMatchObject([
    {service: {iid: 4}, properties: {temperature: {iid: 1}}},
    {service: {iid: 5}, properties: {relativeHumidity: {iid: 1}}},
  ]);
});

test('accepts extra metadata enum values and preserves the declared mapping', () => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, MODE_PROPERTY_TYPE, {
        format: 'uint8',
        'value-list': createValueList([2, 1, 0]),
      }),
    ],
  });
  const [resource] = resolveTestSchema([service], FAN_SCHEMA) ?? [];

  expect(resource?.properties.mode).toMatchObject({
    iid: 2,
    enum: FAN_MODE_ENUM['*'],
    'value-list': createValueList([2, 1, 0]),
  });
});

test.each([
  ['a missing value-list', undefined],
  ['an empty value-list', []],
  ['a non-finite value', [{value: Number.NaN, description: 'Invalid'}]],
  [
    'a duplicate value',
    [
      {value: 0, description: 'First'},
      {value: 0, description: 'Second'},
    ],
  ],
] as const)('omits an optional enum property with %s', (_name, valueList) => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, MODE_PROPERTY_TYPE, {
        format: 'uint8',
        'value-list': copyValueList(valueList),
      }),
    ],
  });
  const [resource] = resolveTestSchema([service], FAN_SCHEMA) ?? [];

  expect(resource?.properties.on?.iid).toBe(1);
  expect(resource?.properties.mode).toBeUndefined();
});

test('accepts a device-supported subset of a declared enum mapping', () => {
  const service = createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, MODE_PROPERTY_TYPE, {
        format: 'uint8',
        'value-list': createValueList([0, 2]),
      }),
    ],
  });
  const [resource] = resolveTestSchema([service], FAN_SCHEMA) ?? [];

  expect(resource?.properties.mode).toMatchObject({
    enum: FAN_MODE_ENUM['*'],
    'value-list': createValueList([0, 2]),
  });
});

test('rejects a required enum property without a known value', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {name: 'mode', enum: FAN_MODE_ENUM},
    },
  } as const satisfies MiotPropertySchema;
  const service = createLightService({
    properties: [
      createProperty(2, MODE_PROPERTY_TYPE, {
        format: 'uint8',
        'value-list': createValueList([2]),
      }),
    ],
  });

  expect(resolveTestSchema([service], schema)).toBeUndefined();
});

test('selects a more specific enum pattern instead of the wildcard fallback', () => {
  const fallback = {normal: 0, natural: 1} as const;
  const deviceSpecific = {normal: 1, natural: 0, sleep: 2} as const;
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {
          '*': fallback,
          [ZHIMI_FAN_DEVICE_PATTERN]: deviceSpecific,
        },
      },
    },
  } as const satisfies MiotPropertySchema;
  const [resource] =
    resolveTestSchema([createModeService()], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }) ?? [];

  expect(resource?.properties.mode?.enum).toEqual(deviceSpecific);

  type ModeProperty = MiotPropertySchemaProperties<typeof schema>['mode'];
  type ModeName = Extract<KeysOfUnion<ModeProperty['enum']>, string>;
  const modeNames = {
    normal: true,
    natural: true,
    sleep: true,
  } as const satisfies Readonly<Record<ModeName, true>>;

  expect(Object.keys(modeNames)).toEqual(['normal', 'natural', 'sleep']);
});

test('selects an enum pattern containing a wildcard within a segment', () => {
  const familyMapping = {natural: 0, normal: 1} as const;
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {[ZHIMI_FAN_FAMILY_PATTERN]: familyMapping},
      },
    },
  } as const satisfies MiotPropertySchema;
  const [resource] =
    resolveTestSchema([createModeService()], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }) ?? [];

  expect(resource?.properties.mode?.enum).toEqual(familyMapping);
});

test('omits an optional enum property when no device type pattern matches', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [ON_PROPERTY_TYPE]: 'on',
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {[DMAKER_FAN_FAMILY_PATTERN]: {normal: 0}},
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;
  const [resource] =
    resolveTestSchema([createModeService()], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }) ?? [];

  expect(resource?.properties.on?.iid).toBe(1);
  expect(resource?.properties.mode).toBeUndefined();
});

test('rejects a required enum property when no device type pattern matches', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {[DMAKER_FAN_FAMILY_PATTERN]: {normal: 0}},
      },
    },
  } as const satisfies MiotPropertySchema;

  expect(
    resolveTestSchema([createModeService()], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }),
  ).toBeUndefined();
});

test.each(['forward', 'reverse'] as const)(
  'rejects equally specific overlapping enum patterns regardless of order (%s)',
  order => {
    const prefixPattern = ZHIMI_FAN_FAMILY_PATTERN;
    const suffixPattern = 'urn:miot-spec-v2:device:fan:0000A005:*mi-fa1';
    const forward = {
      [prefixPattern]: {normal: 0},
      [suffixPattern]: {natural: 1},
    } as const;
    const reverse = {
      [suffixPattern]: {natural: 1},
      [prefixPattern]: {normal: 0},
    } as const;
    const schema = {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {
          name: 'mode',
          enum: order === 'forward' ? forward : reverse,
        },
      },
    } as const satisfies MiotPropertySchema;

    expect(
      resolveTestSchema([createModeService()], schema, {
        deviceType: ZHIMI_FAN_DEVICE_TYPE,
      }),
    ).toBeUndefined();
  },
);

test('rejects overlapping enum patterns without a containment relationship', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {
          [ZHIMI_FAN_FAMILY_PATTERN]: {natural: 0},
          'urn:miot-spec-v2:device:fan:0000A005:*fa1': {normal: 0},
          '*': {normal: 0},
        },
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  expect(
    resolveTestSchema([createModeService([0])], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }),
  ).toEqual([]);
});

test('selects one branch nested within otherwise overlapping patterns', () => {
  const exactMapping = {sleep: 2} as const;
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {
          [ZHIMI_FAN_FAMILY_PATTERN]: {natural: 0},
          'urn:miot-spec-v2:device:fan:0000A005:*fa1': {normal: 1},
          [ZHIMI_FAN_DEVICE_PATTERN]: exactMapping,
          '*': {normal: 0},
        },
      },
    },
  } as const satisfies MiotPropertySchema;
  const [resource] =
    resolveTestSchema([createModeService()], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }) ?? [];

  expect(resource?.properties.mode?.enum).toEqual(exactMapping);
});

test('does not fall back when the selected enum mapping fails metadata validation', () => {
  const schema = {
    [LIGHT_SERVICE_TYPE]: {
      [ON_PROPERTY_TYPE]: 'on',
      [MODE_PROPERTY_TYPE]: {
        name: 'mode',
        enum: {
          '*': {normal: 0, natural: 1},
          [ZHIMI_FAN_DEVICE_PATTERN]: {sleep: 2},
        },
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;
  const [resource] =
    resolveTestSchema([createModeService([0, 1])], schema, {
      deviceType: ZHIMI_FAN_DEVICE_TYPE,
    }) ?? [];

  expect(resource?.properties.on?.iid).toBe(1);
  expect(resource?.properties.mode).toBeUndefined();
});

test.each([
  ['an empty schema', {}],
  ['an empty service type', {'': {[ON_PROPERTY_TYPE]: 'on'}}],
  ['a service without properties', {[LIGHT_SERVICE_TYPE]: {}}],
  ['an empty property type', {[LIGHT_SERVICE_TYPE]: {'': 'on'}}],
  ['an empty string name', {[LIGHT_SERVICE_TYPE]: {[ON_PROPERTY_TYPE]: ''}}],
  [
    'an unsafe property name',
    {[LIGHT_SERVICE_TYPE]: {[ON_PROPERTY_TYPE]: '__proto__'}},
  ],
  [
    'an empty object name',
    {[LIGHT_SERVICE_TYPE]: {[ON_PROPERTY_TYPE]: {name: ''}}},
  ],
  [
    'a duplicate name',
    {
      [LIGHT_SERVICE_TYPE]: {
        [ON_PROPERTY_TYPE]: 'state',
        [BRIGHTNESS_PROPERTY_TYPE]: {name: 'state', optional: true},
      },
    },
  ],
  [
    'an empty enum',
    {[LIGHT_SERVICE_TYPE]: {[MODE_PROPERTY_TYPE]: {name: 'mode', enum: {}}}},
  ],
  [
    'an empty enum pattern',
    {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {name: 'mode', enum: {'': {normal: 0}}},
      },
    },
  ],
  [
    'an empty enum value mapping',
    {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {name: 'mode', enum: {'*': {}}},
      },
    },
  ],
  [
    'an empty enum value key',
    {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {name: 'mode', enum: {'*': {'': 0}}},
      },
    },
  ],
  [
    'a non-finite inner enum value',
    {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {
          name: 'mode',
          enum: {'*': {normal: Number.NaN}},
        },
      },
    },
  ],
  [
    'duplicate enum values',
    {
      [LIGHT_SERVICE_TYPE]: {
        [MODE_PROPERTY_TYPE]: {
          name: 'mode',
          enum: {'*': {normal: 0, natural: 0}},
        },
      },
    },
  ],
] as const)('rejects invalid schema with %s', (_name, schema) => {
  expect(() => resolveTestSchema([], schema as MiotPropertySchema)).toThrow(
    TypeError,
  );
});

test('validates finite and unique MIoT value lists', () => {
  expect(isValidMiotSpecValueList(createValueList([1, 0]))).toBe(true);
});

test.each([
  ['a missing list', undefined],
  ['an empty list', []],
  ['a non-finite value', [{value: Number.NaN, description: 'Invalid'}]],
  [
    'a duplicate value',
    [
      {value: 0, description: 'First'},
      {value: 0, description: 'Second'},
    ],
  ],
] as const)('rejects %s as a MIoT value list', (_name, valueList) => {
  expect(isValidMiotSpecValueList(copyValueList(valueList))).toBe(false);
});

test.each([
  [[0.1, 0.3, 0.1], undefined],
  [[1, 100, 1], 'uint8'],
  [[-128, 127, 1], 'int8'],
] as const)('validates the MIoT value range %j', (valueRange, format) => {
  expect(isValidMiotSpecValueRange([...valueRange], format)).toBe(true);
});

test.each([
  ['a missing range', undefined, undefined],
  ['a non-finite minimum', [Number.NaN, 100, 1], undefined],
  ['a non-finite maximum', [1, Number.POSITIVE_INFINITY, 1], undefined],
  ['a non-finite step', [1, 100, Number.NaN], undefined],
  ['an inverted range', [100, 1, 1], undefined],
  ['an empty range', [1, 1, 1], undefined],
  ['a zero step', [1, 100, 0], undefined],
  ['an unaligned step', [1, 100, 2], undefined],
  ['a fractional integer minimum', [0.5, 100, 0.5], 'uint8'],
  ['an integer format overflow', [1, 256, 1], 'uint8'],
] as const)('rejects %s as a MIoT value range', (_name, valueRange, format) => {
  expect(isValidMiotSpecValueRange(copyValueRange(valueRange), format)).toBe(
    false,
  );
});

function resolveTestSchema(
  services: readonly MiotSpecService[],
  schema: MiotPropertySchema,
  configuration: {
    readonly deviceType?: string;
    readonly allowMultipleOptionalServices?: boolean;
  } = {},
): readonly MiotPropertySchemaResource[] | undefined {
  const {deviceType = TEST_DEVICE_TYPE, ...options} = configuration;

  return resolveMiotPropertySchema(
    {type: deviceType, services},
    schema,
    options,
  );
}

function createModeService(
  values: readonly number[] = [0, 1, 2],
): MiotSpecService {
  return createLightService({
    properties: [
      createProperty(1, ON_PROPERTY_TYPE),
      createProperty(2, MODE_PROPERTY_TYPE, {
        format: 'uint8',
        'value-list': createValueList(values),
      }),
    ],
  });
}

function createLightService(
  overrides: Partial<MiotSpecService> = {},
): MiotSpecService {
  return {
    iid: 2,
    type: `${LIGHT_SERVICE_TYPE}:test-light:1`,
    description: 'Light',
    properties: [createProperty(1, `${ON_PROPERTY_TYPE}:test-light:1`)],
    ...overrides,
  };
}

function createEnvironmentService(
  iid: number,
  properties: readonly MiotSpecProperty[],
): MiotSpecService {
  return {
    iid,
    type: `${ENVIRONMENT_SERVICE_TYPE}:test-device:1`,
    description: 'Environment',
    properties: [...properties],
  };
}

function createSplitEnvironmentServices(): readonly MiotSpecService[] {
  return [
    createEnvironmentService(4, [createProperty(1, TEMPERATURE_PROPERTY_TYPE)]),
    createEnvironmentService(5, [
      createProperty(1, RELATIVE_HUMIDITY_PROPERTY_TYPE),
    ]),
  ];
}

function createProperty(
  iid: number,
  type: string,
  overrides: Partial<MiotSpecProperty> = {},
): MiotSpecProperty {
  return {
    iid,
    type,
    description: `Property ${iid}`,
    format: 'bool',
    access: ['read', 'write', 'notify'],
    ...overrides,
  };
}

function createValueList(values: readonly number[]): MiotSpecValueList {
  return values.map(value => ({value, description: `Value ${value}`}));
}

function copyValueList(
  valueList:
    | readonly {readonly value: number; readonly description: string}[]
    | undefined,
): MiotSpecValueList | undefined {
  return valueList?.map(entry => ({...entry}));
}

function copyValueRange(
  valueRange: readonly [number, number, number] | undefined,
): MiotSpecValueRange | undefined {
  return valueRange === undefined ? undefined : [...valueRange];
}
