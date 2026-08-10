import type {
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from './spec.js';

export function findMiotEndpointMatches<
  TProperties extends Record<string, MiotPropertyMatcher>,
>(
  spec: MiotSpecInstance,
  matcher: MiotEndpointMatcher<TProperties>,
): Array<MiotEndpointMatch<TProperties>> {
  if (matcher.device !== undefined && !matchesType(spec.type, matcher.device)) {
    return [];
  }

  const matches: Array<MiotEndpointMatch<TProperties>> = [];

  for (const service of spec.services) {
    if (!matchesType(service.type, matcher.service)) {
      continue;
    }

    const properties = findProperties(service, matcher.properties);

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
> = {
  readonly device?: string;
  readonly service: string;
  readonly properties: TProperties;
};

export type MiotEndpointMatch<
  TProperties extends Record<string, MiotPropertyMatcher>,
> = {
  readonly service: MiotSpecService;
  readonly properties: {
    readonly [TName in keyof TProperties]: MiotSpecProperty;
  };
};

export type MiotPropertyMatcher = {
  readonly type: string;
  readonly access: readonly MiotPropertyAccess[];
};

export type MiotPropertyAccess = 'read' | 'write' | 'notify';

function findProperties<
  TProperties extends Record<string, MiotPropertyMatcher>,
>(
  service: MiotSpecService,
  matchers: TProperties,
): MiotEndpointMatch<TProperties>['properties'] | undefined {
  const properties: Partial<Record<keyof TProperties, MiotSpecProperty>> = {};

  for (const name of Object.keys(matchers) as Array<keyof TProperties>) {
    const matcher = matchers[name];
    const candidates = (service.properties ?? []).filter(
      property =>
        matchesType(property.type, matcher.type) &&
        matcher.access.every(access => property.access.includes(access)),
    );

    if (candidates.length !== 1) {
      return undefined;
    }

    const [property] = candidates;

    if (property === undefined) {
      return undefined;
    }

    properties[name] = property;
  }

  return properties as MiotEndpointMatch<TProperties>['properties'];
}

function matchesType(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}:`);
}
