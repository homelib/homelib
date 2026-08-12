import type {
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from './spec.js';

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
  readonly format: string;
  readonly access: readonly MiotPropertyAccess[];
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
      property.format === matcher.format &&
      matcher.access.every(access => property.access.includes(access)),
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
