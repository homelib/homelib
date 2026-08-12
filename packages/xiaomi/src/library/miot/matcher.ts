import type {
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
  MiotSpecValueList,
  MiotSpecValueRange,
} from './spec.js';

const MIOT_INTEGER_FORMAT_RANGES: Readonly<
  Record<string, readonly [minimum: number, maximum: number]>
> = {
  int8: [-128, 127],
  int16: [-32_768, 32_767],
  int32: [-2_147_483_648, 2_147_483_647],
  uint8: [0, 255],
  uint16: [0, 65_535],
  uint32: [0, 4_294_967_295],
};

export function findMiotEndpointMatches<
  TProperties extends Record<string, MiotPropertyMatcher>,
  TOptionalProperties extends Record<string, MiotPropertyMatcher> = {},
>(
  spec: MiotSpecInstance,
  matcher: MiotEndpointMatcher<TProperties, TOptionalProperties>,
): Array<MiotEndpointMatch<TProperties, TOptionalProperties>> {
  if (matcher.device !== undefined && !matchesType(spec.type, matcher.device)) {
    return [];
  }

  const matches: Array<MiotEndpointMatch<TProperties, TOptionalProperties>> =
    [];

  for (const service of spec.services) {
    if (!matchesType(service.type, matcher.service)) {
      continue;
    }

    const properties = findProperties(
      service,
      matcher.properties,
      matcher.optionalProperties,
    );

    if (properties !== undefined) {
      matches.push({service, properties});
    }
  }

  return matches;
}

export type MiotEndpointMatcher<
  TProperties extends Record<string, MiotPropertyMatcher> = Record<
    string,
    MiotPropertyMatcher
  >,
  TOptionalProperties extends Record<string, MiotPropertyMatcher> = {},
> = {
  readonly device?: string | readonly string[];
  readonly service: string;
  readonly properties: TProperties;
  readonly optionalProperties?: TOptionalProperties;
};

export type MiotEndpointMatch<
  TProperties extends Record<string, MiotPropertyMatcher>,
  TOptionalProperties extends Record<string, MiotPropertyMatcher> = {},
> = {
  readonly service: MiotSpecService;
  readonly properties: {
    readonly [TName in keyof TProperties]: MiotSpecProperty;
  } & {
    readonly [
      TName in Exclude<keyof TOptionalProperties, keyof TProperties>
    ]?: MiotSpecProperty;
  };
};

export type MiotPropertyMatcher = {
  readonly type: string;
  readonly format: string | readonly string[];
  readonly access: readonly MiotPropertyAccess[];
  readonly unit?: string;
  readonly valueRange?: true;
  readonly valueList?: true | readonly number[];
};

export type MiotPropertyAccess = 'read' | 'write' | 'notify';

function findProperties<
  TProperties extends Record<string, MiotPropertyMatcher>,
  TOptionalProperties extends Record<string, MiotPropertyMatcher>,
>(
  service: MiotSpecService,
  matchers: TProperties,
  optionalMatchers: TOptionalProperties | undefined,
):
  | MiotEndpointMatch<TProperties, TOptionalProperties>['properties']
  | undefined {
  const properties: Record<string, MiotSpecProperty> = {};
  const usedPropertyIids = new Set<number>();

  for (const name of Object.keys(matchers) as Array<keyof TProperties>) {
    const matcher = matchers[name];
    const candidates = findPropertyCandidates(service, matcher);

    if (candidates.length !== 1) {
      return undefined;
    }

    const [property] = candidates;

    if (property === undefined || usedPropertyIids.has(property.iid)) {
      return undefined;
    }

    properties[String(name)] = property;
    usedPropertyIids.add(property.iid);
  }

  const optionalCandidates: Array<
    readonly [name: string, property: MiotSpecProperty]
  > = [];
  const optionalPropertyUseCount = new Map<number, number>();

  for (const name of Object.keys(optionalMatchers ?? {})) {
    if (Object.hasOwn(matchers, name)) {
      continue;
    }

    const matcher = optionalMatchers?.[name];

    if (matcher === undefined) {
      continue;
    }

    const candidates = findPropertyCandidates(service, matcher);
    const [property] = candidates;

    if (
      candidates.length !== 1 ||
      property === undefined ||
      usedPropertyIids.has(property.iid)
    ) {
      continue;
    }

    optionalCandidates.push([name, property]);
    optionalPropertyUseCount.set(
      property.iid,
      (optionalPropertyUseCount.get(property.iid) ?? 0) + 1,
    );
  }

  for (const [name, property] of optionalCandidates) {
    if (optionalPropertyUseCount.get(property.iid) === 1) {
      properties[name] = property;
    }
  }

  return properties as MiotEndpointMatch<
    TProperties,
    TOptionalProperties
  >['properties'];
}

function findPropertyCandidates(
  service: MiotSpecService,
  matcher: MiotPropertyMatcher,
): readonly MiotSpecProperty[] {
  return (service.properties ?? []).filter(
    property =>
      matchesType(property.type, matcher.type) &&
      matchesValue(property.format, matcher.format) &&
      matcher.access.every(access => property.access.includes(access)) &&
      (matcher.unit === undefined || property.unit === matcher.unit) &&
      (matcher.valueRange !== true ||
        isValidMiotSpecValueRange(property['value-range'], property.format)) &&
      (matcher.valueList === undefined ||
        matchesValueList(property['value-list'], matcher.valueList)),
  );
}

export function isValidMiotSpecValueList(
  valueList: MiotSpecValueList | undefined,
): valueList is MiotSpecValueList {
  if (valueList === undefined || valueList.length === 0) {
    return false;
  }

  return isValidUniqueNumberSet(valueList.map(entry => entry.value));
}

export function isValidMiotSpecValueRange(
  valueRange: MiotSpecValueRange | undefined,
  format?: string,
): valueRange is MiotSpecValueRange {
  if (valueRange === undefined) {
    return false;
  }

  const [minimum, maximum, step] = valueRange;

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(step) ||
    minimum >= maximum ||
    step <= 0
  ) {
    return false;
  }

  const stepCount = (maximum - minimum) / step;

  if (!isApproximatelyInteger(stepCount)) {
    return false;
  }

  const formatRange =
    format === undefined ? undefined : MIOT_INTEGER_FORMAT_RANGES[format];

  if (formatRange === undefined) {
    return true;
  }

  const [formatMinimum, formatMaximum] = formatRange;

  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    Number.isInteger(step) &&
    minimum >= formatMinimum &&
    maximum <= formatMaximum
  );
}

function matchesType(
  actual: string,
  expected: string | readonly string[],
): boolean {
  if (typeof expected === 'string') {
    return actual === expected || actual.startsWith(`${expected}:`);
  }

  return expected.some(type => matchesType(actual, type));
}

function matchesValue(
  actual: string,
  expected: string | readonly string[],
): boolean {
  if (typeof expected === 'string') {
    return actual === expected;
  }

  return expected.includes(actual);
}

function matchesValueList(
  actual: MiotSpecValueList | undefined,
  expected: true | readonly number[],
): boolean {
  if (!isValidMiotSpecValueList(actual)) {
    return false;
  } else if (expected === true) {
    return true;
  }

  const actualValues = actual.map(entry => entry.value);

  return (
    isValidUniqueNumberSet(expected) &&
    actualValues.length === expected.length &&
    actualValues.every(value => expected.includes(value))
  );
}

function isValidUniqueNumberSet(values: readonly number[]): boolean {
  return (
    values.every(value => Number.isFinite(value)) &&
    new Set(values).size === values.length
  );
}

function isApproximatelyInteger(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }

  const nearestInteger = Math.round(value);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;

  return Math.abs(value - nearestInteger) <= tolerance;
}
