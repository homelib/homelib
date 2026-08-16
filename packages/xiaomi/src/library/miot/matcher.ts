import type {
  MiotSpecAction,
  MiotSpecEvent,
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
 * One or more comma-separated full-URN prefix patterns. `*` matches one or
 * more non-colon characters, and each successful match must end at a URN
 * segment boundary.
 */
export type MiotUrnPattern = string;

/** Maps HomeLib domain names to MIoT wire values. */
export type MiotEnumValueMapping = Readonly<Record<string, number>>;

/** Selects an enum value mapping from the complete device URN. */
export type MiotEnumMapping = Readonly<
  Record<MiotUrnPattern, MiotEnumValueMapping>
>;

/** Selects a physical property IID from the complete device URN. */
export type MiotPropertyIidMapping = Readonly<Record<MiotUrnPattern, number>>;

/** Selects a vendor value-list override from the complete device URN. */
export type MiotPropertyValueListMapping = Readonly<
  Record<MiotUrnPattern, MiotSpecValueList>
>;

export type MiotPropertyMapping =
  | string
  | {
      readonly name: string;
      readonly enum?: MiotEnumMapping;
      readonly iid?: MiotPropertyIidMapping;
      readonly optional?: true;
      /**
       * Replaces the declared value list for matching device URNs.
       *
       * Vendors sometimes report raw values that their published instance
       * spec omits; the replacement takes effect during resolution so that
       * state validation accepts the corrected set.
       */
      readonly 'value-list'?: MiotPropertyValueListMapping;
    };

export type MiotPropertySchema = Readonly<
  Record<string, Readonly<Record<string, MiotPropertyMapping>>>
>;

export type MiotActionMapping = {
  readonly in: readonly MiotUrnPattern[];
  readonly out?: readonly MiotUrnPattern[];
};

/** Required actions grouped by their owning service URN pattern. */
export type MiotActionSchema = Readonly<
  Record<MiotUrnPattern, Readonly<Record<MiotUrnPattern, MiotActionMapping>>>
>;

export type MiotActionSchemaMatch = {
  readonly service: MiotSpecService;
  readonly action: MiotSpecAction;
  readonly in: readonly MiotSpecProperty[];
  readonly out: readonly MiotSpecProperty[] | undefined;
};

/** Required events grouped by their owning service URN pattern. */
export type MiotEventSchema = Readonly<
  Record<MiotUrnPattern, Readonly<Record<MiotUrnPattern, string>>>
>;

export type MiotEventSchemaMatch = {
  readonly service: MiotSpecService;
  readonly event: MiotSpecEvent;
  readonly name: string;
};

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
    if (
      !isValidMiotUrnPattern(serviceType) ||
      Object.keys(properties).length === 0
    ) {
      throw new TypeError('Invalid MIoT property schema service.');
    }

    for (const [propertyType, mapping] of Object.entries(properties)) {
      if (!isValidMiotUrnPattern(propertyType)) {
        throw new TypeError('Invalid MIoT property schema property.');
      }

      const {
        name,
        enum: enumMapping,
        iid: iidMapping,
        'value-list': valueListMapping,
      } = getPropertyMapping(mapping);

      if (iidMapping !== undefined && !isValidIidMapping(iidMapping)) {
        throw new TypeError('Invalid MIoT property schema IID.');
      }

      if (
        valueListMapping !== undefined &&
        !isValidValueListMapping(valueListMapping)
      ) {
        throw new TypeError('Invalid MIoT property schema value list.');
      }

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

export function assertMiotActionSchema(schema: MiotActionSchema): void {
  const services = Object.entries(schema);

  if (services.length === 0) {
    throw new TypeError('A MIoT action schema requires a service.');
  }

  for (const [serviceType, actions] of services) {
    if (
      !isValidMiotUrnPattern(serviceType) ||
      Object.keys(actions).length === 0
    ) {
      throw new TypeError('Invalid MIoT action schema service.');
    }

    for (const [actionType, mapping] of Object.entries(actions)) {
      if (
        !isValidMiotUrnPattern(actionType) ||
        !mapping.in.every(isValidMiotUrnPattern) ||
        (mapping.out !== undefined && !mapping.out.every(isValidMiotUrnPattern))
      ) {
        throw new TypeError('Invalid MIoT action schema action.');
      }
    }
  }
}

export function assertMiotEventSchema(schema: MiotEventSchema): void {
  const services = Object.entries(schema);

  if (services.length === 0) {
    throw new TypeError('A MIoT event schema requires a service.');
  }

  const nameSet = new Set<string>();

  for (const [serviceType, events] of services) {
    if (
      !isValidMiotUrnPattern(serviceType) ||
      Object.keys(events).length === 0
    ) {
      throw new TypeError('Invalid MIoT event schema service.');
    }

    for (const [eventType, name] of Object.entries(events)) {
      if (
        !isValidMiotUrnPattern(eventType) ||
        name.length === 0 ||
        name === '__proto__' ||
        nameSet.has(name)
      ) {
        throw new TypeError('Invalid MIoT event schema event.');
      }

      nameSet.add(name);
    }
  }
}

export function matchesMiotActionSchema(
  resources: readonly MiotPropertySchemaResource[],
  schema: MiotActionSchema,
): boolean {
  return resolveMiotActionSchema(resources, schema) !== undefined;
}

export function resolveMiotActionSchema(
  resources: readonly MiotPropertySchemaResource[],
  schema: MiotActionSchema,
): readonly MiotActionSchemaMatch[] | undefined {
  assertMiotActionSchema(schema);
  const matches: MiotActionSchemaMatch[] = [];

  for (const [serviceType, actionSchema] of Object.entries(schema)) {
    const matchingResources = resources.filter(resource =>
      matchesMiotUrnPattern(resource.service.type, serviceType),
    );
    const [resource] = matchingResources;

    if (matchingResources.length !== 1 || resource === undefined) {
      return undefined;
    }

    for (const [actionType, mapping] of Object.entries(actionSchema)) {
      const matchingActions = (resource.service.actions ?? []).filter(action =>
        matchesMiotUrnPattern(action.type, actionType),
      );
      const [matchedAction] = matchingActions;
      const inputProperties =
        matchedAction === undefined
          ? undefined
          : resolveActionProperties(
              resource.service,
              matchedAction.in,
              mapping.in,
            );
      const outputProperties =
        matchedAction === undefined || mapping.out === undefined
          ? undefined
          : resolveActionProperties(
              resource.service,
              matchedAction.out,
              mapping.out,
            );

      if (
        matchingActions.length !== 1 ||
        matchedAction === undefined ||
        inputProperties === undefined ||
        (mapping.out !== undefined && outputProperties === undefined)
      ) {
        return undefined;
      }

      matches.push({
        service: resource.service,
        action: matchedAction,
        in: inputProperties,
        out: outputProperties,
      });
    }
  }

  return matches;
}

export function matchesMiotEventSchema(
  spec: MiotSpecMatchContext,
  schema: MiotEventSchema,
): boolean {
  return resolveMiotEventSchema(spec, schema) !== undefined;
}

/**
 * Resolves event schema mappings against the complete spec service list,
 * independently of any property resource resolution. A schema service
 * pattern must match exactly one service, and each mapped event must match
 * exactly one declared event.
 */
export function resolveMiotEventSchema(
  spec: MiotSpecMatchContext,
  schema: MiotEventSchema,
): readonly MiotEventSchemaMatch[] | undefined {
  assertMiotEventSchema(schema);
  const matches: MiotEventSchemaMatch[] = [];
  const serviceIidSet = new Set<number>();

  for (const [serviceType, eventSchema] of Object.entries(schema)) {
    const matchingServices = spec.services.filter(service =>
      matchesMiotUrnPattern(service.type, serviceType),
    );
    const [service] = matchingServices;

    if (matchingServices.length !== 1 || service === undefined) {
      return undefined;
    }

    if (serviceIidSet.has(service.iid)) {
      return undefined;
    }

    serviceIidSet.add(service.iid);

    for (const [eventType, name] of Object.entries(eventSchema)) {
      const matchingEvents = (service.events ?? []).filter(event =>
        matchesMiotUrnPattern(event.type, eventType),
      );
      const [event] = matchingEvents;

      if (matchingEvents.length !== 1 || event === undefined) {
        return undefined;
      }

      matches.push({service, event, name});
    }
  }

  return matches;
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
    const iid =
      mapping.iid === undefined
        ? undefined
        : selectMiotUrnPatternValue(deviceType, mapping.iid);
    const valueList =
      mapping['value-list'] === undefined
        ? undefined
        : selectMiotUrnPatternValue(deviceType, mapping['value-list']);
    const candidates =
      mapping.iid !== undefined && iid === undefined
        ? []
        : findPropertyCandidates(
            service,
            propertyType,
            enumMapping,
            mapping.enum !== undefined,
            iid,
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

      properties[mapping.name] = resolveProperty(
        property,
        enumMapping,
        valueList,
      );
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
      resolveProperty(property, enumMapping, valueList),
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
  iid: number | undefined,
): readonly MiotSpecProperty[] {
  return (service.properties ?? []).filter(property => {
    if (
      !matchesMiotUrnPattern(property.type, propertyType) ||
      (iid !== undefined && property.iid !== iid)
    ) {
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
      Object.values(enumMapping).some(value =>
        valueList.some(entry => entry.value === value),
      )
    );
  });
}

function resolveActionProperties(
  service: MiotSpecService,
  propertyIids: readonly number[],
  propertyTypes: readonly MiotUrnPattern[],
): readonly MiotSpecProperty[] | undefined {
  if (propertyIids.length !== propertyTypes.length) {
    return undefined;
  }

  const properties: MiotSpecProperty[] = [];

  for (const [index, iid] of propertyIids.entries()) {
    const propertyType = propertyTypes[index];
    const candidates = (service.properties ?? []).filter(
      property => property.iid === iid,
    );
    const [property] = candidates;

    if (
      candidates.length !== 1 ||
      property === undefined ||
      propertyType === undefined ||
      !matchesMiotUrnPattern(property.type, propertyType)
    ) {
      return undefined;
    }

    properties.push(property);
  }

  return properties;
}

function resolveProperty(
  property: MiotSpecProperty,
  enumMapping: MiotEnumValueMapping | undefined,
  valueList: MiotSpecValueList | undefined,
): MiotResolvedSpecProperty {
  return Object.assign(
    {},
    property,
    enumMapping === undefined ? {} : {enum: enumMapping},
    valueList === undefined ? {} : {'value-list': valueList},
  );
}

function getPropertyMapping(mapping: MiotPropertyMapping): {
  readonly name: string;
  readonly enum?: MiotEnumMapping;
  readonly iid?: MiotPropertyIidMapping;
  readonly optional: boolean;
  readonly 'value-list'?: MiotPropertyValueListMapping;
} {
  return typeof mapping === 'string'
    ? {name: mapping, optional: false}
    : {
        name: mapping.name,
        enum: mapping.enum,
        iid: mapping.iid,
        optional: mapping.optional === true,
        'value-list': mapping['value-list'],
      };
}

function isValidEnumMapping(mapping: MiotEnumMapping): boolean {
  const entries = Object.entries(mapping);

  return (
    entries.length > 0 &&
    entries.every(
      ([pattern, valueMapping]) =>
        isValidMiotUrnPattern(pattern) && isValidEnumValueMapping(valueMapping),
    )
  );
}

function isValidIidMapping(mapping: MiotPropertyIidMapping): boolean {
  const entries = Object.entries(mapping);

  return (
    entries.length > 0 &&
    entries.every(
      ([pattern, iid]) =>
        isValidMiotUrnPattern(pattern) && Number.isInteger(iid) && iid > 0,
    )
  );
}

function isValidValueListMapping(
  mapping: MiotPropertyValueListMapping,
): boolean {
  const entries = Object.entries(mapping);

  return (
    entries.length > 0 &&
    entries.every(
      ([pattern, valueList]) =>
        isValidMiotUrnPattern(pattern) && isValidMiotSpecValueList(valueList),
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
        isMiotUrnPatternNestedWithin(pattern, otherPattern),
    ),
  );

  return nestedMatches.length === 1 ? nestedMatches[0]?.[1] : undefined;
}

/** Matches a pattern against the beginning of a complete MIoT URN. */
export function matchesMiotUrnPattern(
  urn: string,
  pattern: MiotUrnPattern,
): boolean {
  return getMiotUrnPatternAlternatives(pattern).some(alternative =>
    matchesSingleMiotUrnPattern(urn, alternative),
  );
}

function isValidMiotUrnPattern(pattern: MiotUrnPattern): boolean {
  const alternatives = getMiotUrnPatternAlternatives(pattern);

  return (
    alternatives.length > 0 &&
    alternatives.every(alternative => alternative.length > 0)
  );
}

function getMiotUrnPatternAlternatives(
  pattern: MiotUrnPattern,
): readonly string[] {
  return pattern.split(',').map(alternative => alternative.trim());
}

function isMiotUrnPatternNestedWithin(
  pattern: MiotUrnPattern,
  otherPattern: MiotUrnPattern,
): boolean {
  const alternatives = getMiotUrnPatternAlternatives(pattern);
  const otherAlternatives = getMiotUrnPatternAlternatives(otherPattern);

  return alternatives.every(alternative =>
    otherAlternatives.some(otherAlternative =>
      matchesSingleMiotUrnPattern(alternative, otherAlternative),
    ),
  );
}

function matchesSingleMiotUrnPattern(urn: string, pattern: string): boolean {
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
