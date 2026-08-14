import type {
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

/**
 * A full-URN prefix pattern. `*` matches one or more non-colon characters,
 * and a successful match must end at a URN segment boundary.
 */
export type MiotUrnPattern = string;

/** Maps HomeLib domain names to MIoT wire values. */
export type MiotEnumValueMapping = Readonly<Record<string, number>>;

/** Selects an enum value mapping from the complete device URN. */
export type MiotEnumMapping = Readonly<
  Record<MiotUrnPattern, MiotEnumValueMapping>
>;

export type MiotPropertyMapping =
  | string
  | {
      readonly name: string;
      readonly enum?: MiotEnumMapping;
      readonly optional?: true;
    };

export type MiotPropertySchema = Readonly<
  Record<string, Readonly<Record<string, MiotPropertyMapping>>>
>;

export type MiotSpecMatchContext = {
  readonly type: string;
  readonly services: readonly MiotSpecService[];
};

export type MiotResolvedSpecProperty = MiotSpecProperty & {
  readonly enum?: MiotEnumValueMapping;
};

export type MiotPropertySchemaResource = {
  readonly service: MiotSpecService;
  readonly properties: Readonly<Record<string, MiotResolvedSpecProperty>>;
};

type MiotPropertySchemaMapping<TSchema extends MiotPropertySchema> = {
  readonly [TService in keyof TSchema]: TSchema[TService] extends Readonly<
    Record<string, MiotPropertyMapping>
  >
    ? TSchema[TService][keyof TSchema[TService]]
    : never;
}[keyof TSchema];

type MiotPropertyMappingName<TMapping> = TMapping extends string
  ? TMapping
  : TMapping extends {readonly name: infer TName extends string}
    ? TName
    : never;

type MiotRequiredPropertyName<TMapping> = TMapping extends {
  readonly optional: true;
}
  ? never
  : MiotPropertyMappingName<TMapping>;

type MiotOptionalPropertyName<TMapping> = TMapping extends {
  readonly optional: true;
}
  ? MiotPropertyMappingName<TMapping>
  : never;

type MiotPropertyMappingForName<TMapping, TName> =
  TMapping extends MiotPropertyMapping
    ? MiotPropertyMappingName<TMapping> extends TName
      ? TMapping
      : never
    : never;

type MiotResolvedPropertyForName<
  TSchema extends MiotPropertySchema,
  TName,
> = Omit<MiotResolvedSpecProperty, 'enum'> & {
  readonly name: Extract<TName, string>;
} & (MiotPropertyMappingForName<
    MiotPropertySchemaMapping<TSchema>,
    TName
  > extends infer TMapping
    ? TMapping extends {readonly enum: infer TEnum extends MiotEnumMapping}
      ? {readonly enum: TEnum[keyof TEnum]}
      : {readonly enum?: undefined}
    : never);

export type MiotPropertySchemaProperties<TSchema extends MiotPropertySchema> =
  Readonly<
    {
      readonly [
        TName in MiotRequiredPropertyName<MiotPropertySchemaMapping<TSchema>>
      ]: MiotResolvedPropertyForName<TSchema, TName>;
    } & {
      readonly [
        TName in MiotOptionalPropertyName<MiotPropertySchemaMapping<TSchema>>
      ]?: MiotResolvedPropertyForName<TSchema, TName>;
    }
  >;

export function assertMiotPropertySchema(schema: MiotPropertySchema): void {
  const services = Object.entries(schema);

  if (services.length === 0) {
    throw new TypeError('A MIoT property schema requires a service.');
  }

  const nameSet = new Set<string>();

  for (const [serviceType, properties] of services) {
    if (serviceType.length === 0 || Object.keys(properties).length === 0) {
      throw new TypeError('Invalid MIoT property schema service.');
    }

    for (const [propertyType, mapping] of Object.entries(properties)) {
      if (propertyType.length === 0) {
        throw new TypeError('Invalid MIoT property schema property.');
      }

      const {name, enum: enumMapping} = getPropertyMapping(mapping);

      if (name.length === 0 || name === '__proto__' || nameSet.has(name)) {
        throw new TypeError('Invalid MIoT property schema name.');
      }

      nameSet.add(name);

      if (enumMapping !== undefined && !isValidEnumMapping(enumMapping)) {
        throw new TypeError('Invalid MIoT property schema enum.');
      }
    }
  }
}

export function resolveMiotPropertySchema(
  spec: MiotSpecMatchContext,
  schema: MiotPropertySchema,
  options: {readonly allowMultipleOptionalServices?: boolean} = {},
): readonly MiotPropertySchemaResource[] | undefined {
  assertMiotPropertySchema(schema);

  const {services, type: deviceType} = spec;
  const resources: MiotPropertySchemaResource[] = [];
  const serviceIidSet = new Set<number>();

  for (const [serviceType, propertySchema] of Object.entries(schema)) {
    const required = Object.values(propertySchema).some(
      mapping => !getPropertyMapping(mapping).optional,
    );
    const matches = services.flatMap(service => {
      if (!matchesMiotUrnPattern(service.type, serviceType)) {
        return [];
      }

      const properties = resolveServiceProperties(
        deviceType,
        service,
        propertySchema,
      );

      return properties === undefined ||
        (!required && Object.keys(properties).length === 0)
        ? []
        : [{service, properties}];
    });

    if (
      (required && matches.length !== 1) ||
      (!required &&
        !options.allowMultipleOptionalServices &&
        matches.length > 1)
    ) {
      return undefined;
    }

    for (const match of matches) {
      if (serviceIidSet.has(match.service.iid)) {
        return undefined;
      }

      serviceIidSet.add(match.service.iid);
      resources.push(match);
    }
  }

  return resources;
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

function resolveServiceProperties(
  deviceType: string,
  service: MiotSpecService,
  schema: Readonly<Record<string, MiotPropertyMapping>>,
): Readonly<Record<string, MiotResolvedSpecProperty>> | undefined {
  const properties: Record<string, MiotResolvedSpecProperty> = {};
  const usedPropertyIids = new Set<number>();
  const optionalCandidates: Array<
    readonly [name: string, property: MiotResolvedSpecProperty]
  > = [];
  const optionalPropertyUseCount = new Map<number, number>();

  for (const [propertyType, configuredMapping] of Object.entries(schema)) {
    const mapping = getPropertyMapping(configuredMapping);
    const enumMapping =
      mapping.enum === undefined
        ? undefined
        : selectMiotUrnPatternValue(deviceType, mapping.enum);
    const candidates = findPropertyCandidates(
      service,
      propertyType,
      enumMapping,
      mapping.enum !== undefined,
    );
    const [property] = candidates;

    if (!mapping.optional) {
      if (
        candidates.length !== 1 ||
        property === undefined ||
        usedPropertyIids.has(property.iid)
      ) {
        return undefined;
      }

      properties[mapping.name] = resolveProperty(property, enumMapping);
      usedPropertyIids.add(property.iid);
      continue;
    }

    if (
      candidates.length !== 1 ||
      property === undefined ||
      usedPropertyIids.has(property.iid)
    ) {
      continue;
    }

    optionalCandidates.push([
      mapping.name,
      resolveProperty(property, enumMapping),
    ]);
    optionalPropertyUseCount.set(
      property.iid,
      (optionalPropertyUseCount.get(property.iid) ?? 0) + 1,
    );
  }

  for (const [name, property] of optionalCandidates) {
    if (
      optionalPropertyUseCount.get(property.iid) === 1 &&
      !usedPropertyIids.has(property.iid)
    ) {
      properties[name] = property;
    }
  }

  return properties;
}

function findPropertyCandidates(
  service: MiotSpecService,
  propertyType: string,
  enumMapping: MiotEnumValueMapping | undefined,
  requiresEnumMapping: boolean,
): readonly MiotSpecProperty[] {
  return (service.properties ?? []).filter(property => {
    if (!matchesMiotUrnPattern(property.type, propertyType)) {
      return false;
    }

    // Vendor instances can declare different access modes for the same base
    // property type.
    // State-backed aliases must remain observable between commands so that
    // acknowledged effects can be reconciled with manual device changes.
    if (
      !property.access.includes('read') ||
      !property.access.includes('notify')
    ) {
      return false;
    }

    if (enumMapping === undefined) {
      return !requiresEnumMapping;
    }

    const valueList = property['value-list'];

    return (
      isValidMiotSpecValueList(valueList) &&
      Object.values(enumMapping).every(value =>
        valueList.some(entry => entry.value === value),
      )
    );
  });
}

function resolveProperty(
  property: MiotSpecProperty,
  enumMapping: MiotEnumValueMapping | undefined,
): MiotResolvedSpecProperty {
  return enumMapping === undefined
    ? property
    : Object.assign({}, property, {enum: enumMapping});
}

function getPropertyMapping(mapping: MiotPropertyMapping): {
  readonly name: string;
  readonly enum?: MiotEnumMapping;
  readonly optional: boolean;
} {
  return typeof mapping === 'string'
    ? {name: mapping, optional: false}
    : {
        name: mapping.name,
        enum: mapping.enum,
        optional: mapping.optional === true,
      };
}

function isValidEnumMapping(mapping: MiotEnumMapping): boolean {
  const entries = Object.entries(mapping);

  return (
    entries.length > 0 &&
    entries.every(
      ([pattern, valueMapping]) =>
        pattern.length > 0 && isValidEnumValueMapping(valueMapping),
    )
  );
}

function isValidEnumValueMapping(mapping: MiotEnumValueMapping): boolean {
  const entries = Object.entries(mapping);

  return (
    entries.length > 0 &&
    entries.every(([key, value]) => key.length > 0 && Number.isFinite(value)) &&
    new Set(entries.map(([, value]) => value)).size === entries.length
  );
}

/** Selects a matching pattern that is nested within every other match. */
export function selectMiotUrnPatternValue<T>(
  urn: string,
  values: Readonly<Record<MiotUrnPattern, T>>,
): T | undefined {
  const matches = Object.entries(values).filter(([pattern]) =>
    matchesMiotUrnPattern(urn, pattern),
  );
  const nestedMatches = matches.filter(([pattern]) =>
    matches.every(
      ([otherPattern]) =>
        pattern === otherPattern ||
        matchesMiotUrnPattern(pattern, otherPattern),
    ),
  );

  return nestedMatches.length === 1 ? nestedMatches[0]?.[1] : undefined;
}

/** Matches a pattern against the beginning of a complete MIoT URN. */
export function matchesMiotUrnPattern(
  urn: string,
  pattern: MiotUrnPattern,
): boolean {
  const source = pattern
    .split('*')
    .map(part => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('[^:]+');

  return new RegExp(`^${source}(?=:|$)`).test(urn);
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
