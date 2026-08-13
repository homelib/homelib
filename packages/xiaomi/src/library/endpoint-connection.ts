import {
  type Command,
  CommandError,
  type EndpointConnection,
  EndpointConnectionError,
  type EndpointConnectionMetadata,
} from '@homelib/core';
import {action, computed, observable} from 'mobx';
import * as x from 'x-value';

import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
  type MiotSpecProperty,
  MiotSpecService,
  isSuccessfulMiotExecutionResult,
  isValidMiotSpecValueList,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

/** A peer MIoT service snapshot claimed by one logical endpoint. */
export const MiotEndpointConnectionResource = x.object({
  service: MiotSpecService,
});

export const MiotEndpointConnectionMetadata = x
  .object({
    device: x.object({
      did: x.string,
      model: x.string.optional(),
      urn: x.string,
    }),
    resources: x.array(MiotEndpointConnectionResource),
  })
  .refined(metadata => {
    assertMiotEndpointConnectionResources(metadata.resources);
    return metadata;
  });

export function normalizeMiotEndpointConnectionMetadata(
  value: unknown,
): MiotEndpointConnectionMetadata {
  return MiotEndpointConnectionMetadata.sanitize(value);
}

export function getMiotEndpointConnectionProperty(
  metadata: MiotEndpointConnectionResolvedMetadata,
  name: string,
): {
  readonly service: MiotSpecService;
  readonly property: MiotSpecProperty;
} {
  for (const {service, properties} of metadata.resources) {
    const property = properties[name];

    if (property !== undefined) {
      return {service, property};
    }
  }

  throw new TypeError(`Unknown MIoT endpoint property: ${name}.`);
}

export function getMiotEndpointConnectionResourceKeys(
  metadata: MiotEndpointConnectionMetadata,
): readonly string[] {
  // Every service is exclusive for now. If sharing becomes necessary, model it
  // explicitly instead of reintroducing an implicit primary/supplement split.
  return metadata.resources
    .toSorted(compareMiotEndpointResources)
    .map(resource => getMiotResourceKey(metadata.device.did, resource));
}

export abstract class MiotEndpointConnection<
  in TCommand extends Command,
> implements EndpointConnection<TCommand> {
  @observable.shallow private accessor stateMap = new Map<string, unknown>();

  @observable private accessor readyValue = false;

  protected readonly transports: MiotEndpointConnectionTransports;

  @computed
  get ready(): boolean {
    return this.readyValue;
  }

  get stateProperties(): readonly MiotProperty[] {
    const {metadata} = this;
    return metadata.resources.flatMap(resource => {
      return Object.values(resource.properties).map(property => {
        return {
          did: metadata.device.did,
          siid: resource.service.iid,
          piid: property.iid,
        };
      });
    });
  }

  constructor(
    readonly provider: MiotProvider,
    readonly metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    this.transports = transports;
  }

  @action
  handlePropertyUpdate(update: MiotPropertyUpdate): void {
    const [state] = this.prepareStateUpdates([update]);

    if (state === undefined) {
      throw new TypeError('Missing MIoT endpoint property update.');
    }

    this.stateMap.set(state.name, state.value);
  }

  @action
  handleStateUpdate(update: MiotEndpointStateUpdate): void {
    if (update.did !== this.metadata.device.did) {
      throw new TypeError('Unexpected MIoT endpoint state update.');
    }

    if (!update.online) {
      this.readyValue = false;
      return;
    }

    const states = this.prepareStateUpdates(update.properties);

    if (states.length !== getMiotEndpointPropertyCount(this.metadata)) {
      throw new TypeError('Incomplete MIoT endpoint state update.');
    }

    for (const {name, value} of states) {
      this.stateMap.set(name, value);
    }

    this.readyValue = true;
  }

  abstract processCommand(command: TCommand): Promise<void>;

  protected getState(name: string): unknown {
    return this.stateMap.get(name);
  }

  toLogString(): string {
    const {device} = this.metadata;
    const serviceIids = this.metadata.resources
      .toSorted(compareMiotEndpointResources)
      .map(({service}) => service.iid);

    return `miot ${this.provider.name} · did ${device.did} · services ${serviceIids.join(',')}`;
  }

  protected async executeRequest(request: MiotExecutionRequest): Promise<void> {
    let lastUnavailableError:
      MiotEndpointConnectionTransportUnavailableError | undefined;

    for (const transport of this.transports) {
      let result: MiotExecutionResult;

      try {
        result = await transport.executeRequest(request);
      } catch (error) {
        if (error instanceof MiotEndpointConnectionTransportUnavailableError) {
          lastUnavailableError = error;
          continue;
        }

        throw createMiotEndpointConnectionTransportError(error);
      }

      if (!isSuccessfulMiotExecutionResult(result)) {
        throw new CommandError(`MIoT request failed: ${result.code}.`);
      }

      return;
    }

    throw createMiotEndpointConnectionTransportError(lastUnavailableError);
  }

  private prepareStateUpdates(
    updates: readonly MiotPropertyUpdate[],
  ): Array<{readonly name: string; readonly value: unknown}> {
    const states: Array<{readonly name: string; readonly value: unknown}> = [];
    const stateNameSet = new Set<string>();

    for (const update of updates) {
      const state = this.getStateUpdate(update);

      if (stateNameSet.has(state.name)) {
        throw new TypeError('Duplicate MIoT endpoint property update.');
      }

      stateNameSet.add(state.name);
      states.push(state);
    }

    return states;
  }

  private getStateUpdate(update: MiotPropertyUpdate): {
    readonly name: string;
    readonly value: unknown;
  } {
    const {metadata} = this;

    if (update.did !== metadata.device.did) {
      throw new TypeError('Unexpected MIoT endpoint property update.');
    }

    const resource = metadata.resources.find(candidate => {
      return candidate.service.iid === update.siid;
    });

    if (resource === undefined) {
      throw new TypeError('Unexpected MIoT endpoint property update.');
    }

    let stateName: string | undefined;
    let stateProperty: MiotSpecProperty | undefined;

    for (const [name, property] of Object.entries(resource.properties)) {
      if (property.iid !== update.piid) {
        continue;
      }

      if (stateName !== undefined) {
        throw new TypeError('Ambiguous MIoT endpoint property update.');
      }

      stateName = name;
      stateProperty = property;
    }

    if (stateName === undefined || stateProperty === undefined) {
      throw new TypeError('Unexpected MIoT endpoint property update.');
    }

    assertMiotPropertyValue(stateProperty, update.value, stateName, update);
    return {name: stateName, value: update.value};
  }
}

export abstract class MiotEndpointConnectionTransport {
  abstract executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult>;
}

/**
 * Signals that a transport could not route a request before publishing it.
 *
 * A transport must not throw this error after the request may have been sent,
 * because endpoint connections use it as the only safe signal to try the next
 * transport.
 */
export class MiotEndpointConnectionTransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type MiotEndpointConnectionTransports = readonly [
  MiotEndpointConnectionTransport,
  ...MiotEndpointConnectionTransport[],
];

export type MiotEndpointConnectionMetadata = EndpointConnectionMetadata &
  Readonly<x.TypeOf<typeof MiotEndpointConnectionMetadata>>;

export type MiotEndpointConnectionResource = Readonly<
  x.TypeOf<typeof MiotEndpointConnectionResource>
>;

/** A physical resource enriched with aliases derived from current profiles. */
export type MiotEndpointConnectionResolvedResource =
  MiotEndpointConnectionResource & {
    readonly properties: Readonly<Record<string, MiotSpecProperty>>;
  };

export type MiotEndpointConnectionResolvedMetadata = Omit<
  MiotEndpointConnectionMetadata,
  'resources'
> & {
  readonly resources: readonly MiotEndpointConnectionResolvedResource[];
};

export function createMiotEndpointConnectionResolvedMetadata(
  metadata: MiotEndpointConnectionMetadata,
  resources: readonly MiotEndpointConnectionResolvedResource[],
): MiotEndpointConnectionResolvedMetadata {
  const physicalResourceMap = new Map(
    metadata.resources.map(resource => [resource.service.iid, resource]),
  );
  const resolvedServiceIidSet = new Set<number>();
  const stateNameSet = new Set<string>();
  const propertyKeySet = new Set<string>();

  if (resources.length !== metadata.resources.length) {
    throw new TypeError('Invalid resolved MIoT endpoint resources.');
  }

  const resolvedResources = resources.map(resource => {
    if (resolvedServiceIidSet.has(resource.service.iid)) {
      throw new TypeError('Duplicate resolved MIoT endpoint resource.');
    }

    resolvedServiceIidSet.add(resource.service.iid);
    const physicalResource = physicalResourceMap.get(resource.service.iid);

    if (physicalResource === undefined) {
      throw new TypeError('Invalid resolved MIoT endpoint resource.');
    }

    for (const [name, property] of Object.entries(resource.properties)) {
      const propertyKey = JSON.stringify([resource.service.iid, property.iid]);

      if (stateNameSet.has(name) || propertyKeySet.has(propertyKey)) {
        throw new TypeError('Ambiguous resolved MIoT endpoint property.');
      }

      if (
        !physicalResource.service.properties?.some(candidate =>
          miotSpecPropertiesEqual(candidate, property),
        )
      ) {
        throw new TypeError(
          'Resolved MIoT endpoint property does not belong to its service.',
        );
      }

      stateNameSet.add(name);
      propertyKeySet.add(propertyKey);
    }

    return {
      service: physicalResource.service,
      properties: resource.properties,
    };
  });

  return {device: metadata.device, resources: resolvedResources};
}

export type MiotPropertyUpdate = MiotProperty & {
  readonly value: unknown;
};

export type MiotEndpointStateUpdate = {
  readonly did: string;
  readonly online: boolean;
  readonly properties: readonly MiotPropertyUpdate[];
};

function assertMiotEndpointConnectionResources(
  resources: readonly MiotEndpointConnectionResource[],
): void {
  if (resources.length === 0) {
    throw new TypeError(
      'MIoT endpoint metadata requires at least one resource.',
    );
  }

  const serviceIidSet = new Set<number>();
  for (const resource of resources) {
    if (serviceIidSet.has(resource.service.iid)) {
      throw new TypeError('Duplicate MIoT endpoint metadata service.');
    }

    serviceIidSet.add(resource.service.iid);
  }
}

function miotSpecPropertiesEqual(
  left: MiotSpecProperty,
  right: MiotSpecProperty,
): boolean {
  return left.iid === right.iid && left.type === right.type;
}

function getMiotResourceKey(
  did: string,
  resource: MiotEndpointConnectionResource,
): string {
  return JSON.stringify([did, resource.service.iid]);
}

function compareMiotEndpointResources(
  left: MiotEndpointConnectionResource,
  right: MiotEndpointConnectionResource,
): number {
  return left.service.iid - right.service.iid;
}

function getMiotEndpointPropertyCount(
  metadata: MiotEndpointConnectionResolvedMetadata,
): number {
  return metadata.resources.reduce((count, resource) => {
    return count + Object.keys(resource.properties).length;
  }, 0);
}

function createMiotEndpointConnectionTransportError(
  error: unknown,
): EndpointConnectionError {
  const message =
    error instanceof Error
      ? `MIoT transport failed: ${error.message}`
      : 'MIoT transport failed.';
  return new EndpointConnectionError(message);
}

function assertMiotPropertyValue(
  property: MiotSpecProperty,
  value: unknown,
  stateName: string,
  update: MiotPropertyUpdate,
): void {
  const {format} = property;
  let numericValue: number | undefined;

  if (format === 'bool') {
    if (typeof value !== 'boolean') {
      throw new TypeError('Invalid MIoT boolean property state.');
    }
  } else if (format === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError('Invalid MIoT string property state.');
    }
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('Invalid MIoT numeric property state.');
    }

    if (/^(?:u?int(?:8|16|32))$/.test(format) && !Number.isInteger(value)) {
      throw new TypeError('Invalid MIoT integer property state.');
    }

    numericValue = value;
  }

  const valueList = property['value-list'];

  if (valueList !== undefined) {
    if (
      !isValidMiotSpecValueList(valueList) ||
      !valueList.some(entry => entry.value === numericValue)
    ) {
      throw new TypeError('Invalid MIoT value-list property state.');
    }
  }

  const valueRange = property['value-range'];

  if (valueRange === undefined || numericValue === undefined) {
    return;
  }

  // The third value describes control precision. A device may report a finer
  // sensor value, so state validation only applies the declared boundaries.
  const [minimum, maximum] = valueRange;

  if (numericValue < minimum || numericValue > maximum) {
    throw new TypeError(
      `Invalid MIoT ranged property state. ${stateName}=${numericValue} at did ${update.did}, siid ${update.siid}, piid ${update.piid}; expected ${minimum}..${maximum}.`,
    );
  }
}
