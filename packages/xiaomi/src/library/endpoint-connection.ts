import {
  type Command,
  CommandError,
  type CommandExecution,
  type EndpointConnection,
  EndpointConnectionError,
  type EndpointConnectionMetadata,
  Temperature,
} from '@homelib/core';
import {action, computed, observable} from 'mobx';
import * as x from 'x-value';

import {
  type MiotEvent,
  type MiotEventArgument,
  type MiotEventArguments,
  type MiotEventSchema,
  type MiotEventSchemaNames,
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  type MiotResolvedSpecProperty,
  type MiotSpecEvent,
  type MiotSpecProperty,
  MiotSpecService,
  type MiotSpecValueList,
  type MiotSpecValueRange,
  isSuccessfulMiotExecutionResult,
  isValidMiotSpecValueList,
  isValidMiotSpecValueRange,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

const MIOT_NUMERIC_FORMAT_RANGES: Readonly<
  Record<string, readonly [minimum: number, maximum: number] | undefined>
> = {
  float: undefined,
  int8: [-128, 127],
  int16: [-32_768, 32_767],
  int32: [-2_147_483_648, 2_147_483_647],
  uint8: [0, 255],
  uint16: [0, 65_535],
  uint32: [0, 4_294_967_295],
};

declare const MIOT_ENDPOINT_CONNECTION_EVENT_SCHEMA: unique symbol;

/** A canonical primitive accepted by the MIoT property protocol. */
export type MiotPropertyValue = boolean | number | string;

declare const MIOT_ENCODED_PROPERTY_VALUE: unique symbol;

/** A physical MIoT value that has been canonicalized for a property. */
export type MiotEncodedPropertyValue<
  TValue extends MiotPropertyValue = MiotPropertyValue,
> = TValue & {
  readonly [MIOT_ENCODED_PROPERTY_VALUE]: true;
};

/** A legacy MIoT service snapshot claimed by one logical endpoint. */
export const MiotEndpointConnectionResource = x.object({
  service: MiotSpecService,
});

const MiotEndpointConnectionDevice = x.object({
  did: x.string,
  model: x.string.optional(),
  urn: x.string,
});

/**
 * Stable binding identity. Runtime resources are derived from the current
 * connection schema and the cached complete MIoT spec instead of being saved
 * in the binding file.
 */
export const MiotEndpointConnectionIdentityMetadata = x.object({
  version: x.literal(1),
  device: MiotEndpointConnectionDevice,
});

export const LegacyMiotEndpointConnectionMetadata = x
  .object({
    version: x.undefined.optional(),
    device: MiotEndpointConnectionDevice,
    resources: x.array(MiotEndpointConnectionResource),
  })
  .refined(metadata => {
    assertMiotEndpointConnectionResources(metadata.resources);
    return metadata;
  });

export const MiotEndpointConnectionMetadata = x.union([
  MiotEndpointConnectionIdentityMetadata,
  LegacyMiotEndpointConnectionMetadata,
]);

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
  readonly property: MiotResolvedSpecProperty;
} {
  for (const {service, properties} of metadata.resources) {
    const property = properties[name];

    if (property !== undefined) {
      return {service, property};
    }
  }

  throw new TypeError(`Unknown MIoT endpoint property: ${name}.`);
}

export function getMiotEndpointConnectionEvent(
  metadata: MiotEndpointConnectionResolvedMetadata,
  name: string,
): {
  readonly service: MiotSpecService;
  readonly event: MiotSpecEvent;
} {
  for (const {service, events} of metadata.resources) {
    const event = events?.[name];

    if (event !== undefined) {
      return {service, event};
    }
  }

  throw new TypeError(`Unknown MIoT endpoint event: ${name}.`);
}

export function getMiotEndpointConnectionResourceKeys(
  metadata: MiotEndpointConnectionResolvedMetadata,
): readonly string[] {
  // Every service resolved for one endpoint is exclusive for now.
  return metadata.resources
    .toSorted(compareMiotEndpointResources)
    .map(resource => getMiotResourceKey(metadata.device.did, resource));
}

type MiotPropertyStateEntry = {
  readonly value: unknown;
  readonly available: boolean;
};

export abstract class MiotEndpointConnection<
  in TCommand extends Command,
  TSchema extends MiotPropertySchema = {},
  TEventSchema extends MiotEventSchema = MiotEventSchema,
> implements EndpointConnection<TCommand> {
  declare readonly [MIOT_ENDPOINT_CONNECTION_EVENT_SCHEMA]: TEventSchema;

  @observable.shallow private accessor stateMap = new Map<
    string,
    MiotPropertyStateEntry
  >();

  @observable private accessor readyValue = false;

  @observable private accessor stateRevisionValue = 0;

  private readonly observationRevisionMap = new Map<string, number>();

  private readonly propertyValueCodecCache = new WeakMap<
    object,
    Map<string, unknown>
  >();

  protected readonly properties: MiotEndpointConnectionSchemaProperties<TSchema>;

  protected readonly events: MiotEndpointConnectionEvents;

  protected readonly transports: MiotEndpointConnectionTransports;

  @computed
  get ready(): boolean {
    return this.readyValue;
  }

  @computed
  get stateRevision(): number {
    return this.stateRevisionValue;
  }

  /** Properties selected for snapshot observation. */
  get snapshotProperties(): readonly MiotProperty[] {
    return this.getProperties((name, property) => {
      return this.isSnapshotProperty(name, property);
    });
  }

  /** Snapshot properties that prefer cloud state over an available local route. */
  get cloudPreferredSnapshotProperties(): readonly MiotProperty[] {
    return this.getProperties((name, property) => {
      return (
        this.isSnapshotProperty(name, property) &&
        this.shouldPreferCloudSnapshotProperty(name, property)
      );
    });
  }

  /** Snapshot properties whose buffered notifications must replay afterward. */
  get replaySnapshotPropertyNotifications(): readonly MiotProperty[] {
    return this.getProperties((name, property) => {
      return (
        property.access.includes('notify') &&
        this.isSnapshotProperty(name, property) &&
        this.shouldReplaySnapshotPropertyNotifications(name, property)
      );
    });
  }

  /** Events after which this endpoint needs a fresh property snapshot. */
  get snapshotRefreshEvents(): readonly MiotEvent[] {
    return this.getEvents((name, event) => {
      return this.shouldRefreshSnapshotOnEvent(name, event);
    });
  }

  /** Incremental property and event notifications handled by this endpoint. */
  get notificationTargets(): readonly MiotEndpointNotificationTarget[] {
    const properties = this.getProperties((_name, property) =>
      property.access.includes('notify'),
    ).map(data => {
      return {type: 'property-change', data} as const;
    });
    const events = this.getEvents(() => true).map(data => {
      return {type: 'event', data} as const;
    });

    return [...properties, ...events];
  }

  /** @deprecated Use {@link snapshotProperties}. */
  get stateProperties(): readonly MiotProperty[] {
    return this.snapshotProperties;
  }

  /** @deprecated Read event targets from {@link notificationTargets}. */
  get stateEvents(): readonly MiotEvent[] {
    return this.notificationTargets.flatMap(target => {
      return target.type === 'event' ? [target.data] : [];
    });
  }

  private getProperties(
    select: (name: string, property: MiotResolvedSpecProperty) => boolean,
  ): readonly MiotProperty[] {
    const {metadata} = this;
    return metadata.resources.flatMap(resource => {
      return Object.entries(resource.properties)
        .filter(([name, property]) => select(name, property))
        .map(([, property]) => {
          return {
            did: metadata.device.did,
            siid: resource.service.iid,
            piid: property.iid,
          };
        });
    });
  }

  private getEvents(
    select: (name: string, event: MiotSpecEvent) => boolean,
  ): readonly MiotEvent[] {
    const {metadata} = this;
    return metadata.resources.flatMap(resource => {
      return Object.entries(resource.events ?? {})
        .filter(([name, event]) => select(name, event))
        .map(([, event]) => {
          return {
            did: metadata.device.did,
            siid: resource.service.iid,
            eiid: event.iid,
          };
        });
    });
  }

  /** Returns the latest observation revision among the resolved aliases. */
  getObservationRevision(names: Iterable<string>): number {
    let revision = 0;

    for (const name of names) {
      revision = Math.max(revision, this.observationRevisionMap.get(name) ?? 0);
    }

    return revision;
  }

  /** @internal Returns the currently available raw MIoT observation. */
  getCommandEffectState(name: string): unknown {
    const state = this.stateMap.get(name);
    return state?.available === true ? state.value : undefined;
  }

  constructor(
    readonly provider: MiotProvider,
    readonly metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    this.transports = transports;
    this.properties =
      this.createProperties() as MiotEndpointConnectionSchemaProperties<TSchema>;
    this.events = this.createEvents();
  }

  /** Dispatches one validated incremental notification atomically. */
  @action
  handleNotification(notification: MiotEndpointNotification): void {
    if (notification.type === 'property-change') {
      const [state] = this.prepareStateUpdates([notification.data]);

      if (state === undefined) {
        throw new TypeError('Missing MIoT endpoint property notification.');
      }

      this.stateMap.set(state.name, {value: state.value, available: true});
      this.handlePropertyStateChange(state.name, state.value);
      this.stateRevisionValue++;
      this.observationRevisionMap.set(state.name, this.stateRevisionValue);
      return;
    }

    const event = this.prepareEventNotification(notification.data);

    this.handleEvent(event.name, event.event, event.arguments);
    this.stateRevisionValue++;
  }

  /** @deprecated Use {@link handleNotification}. */
  handlePropertyUpdate(update: MiotPropertyUpdate): void {
    this.handleNotification({type: 'property-change', data: update});
  }

  /** @deprecated Use {@link handleNotification}. */
  handleEventUpdate(update: MiotEventUpdate): void {
    this.handleNotification({type: 'event', data: update});
  }

  /** Marks selected snapshot observations unavailable without going offline. */
  @action
  handleSnapshotInvalidation(properties: readonly MiotProperty[]): void {
    const invalidations = this.prepareSnapshotInvalidations(properties);

    if (invalidations.length === 0) {
      return;
    }

    const revision = this.stateRevisionValue + 1;

    for (const {name} of invalidations) {
      this.markPropertyStateUnavailable(name);
      this.observationRevisionMap.set(name, revision);
      this.handleSnapshotPropertyInvalidated(name);
    }

    this.stateRevisionValue = revision;
  }

  @action
  handleStateUpdate(update: MiotEndpointStateUpdate): readonly Error[] {
    if (update.did !== this.metadata.device.did) {
      throw new TypeError('Unexpected MIoT endpoint state update.');
    }

    if (!update.online) {
      const revision = this.stateRevisionValue + 1;

      for (const name of this.stateMap.keys()) {
        this.markPropertyStateUnavailable(name);
        this.observationRevisionMap.set(name, revision);
      }

      this.readyValue = false;
      this.handleStateInvalidated();
      this.stateRevisionValue = revision;
      return [];
    }

    const prepared = this.prepareSnapshotStateUpdates(update.properties);
    const explicitInvalidations = this.prepareSnapshotInvalidations(
      update.invalidatedProperties ?? [],
    );

    for (const {property} of explicitInvalidations) {
      if (prepared.propertyKeySet.has(getMiotPropertyKey(property))) {
        throw new TypeError(
          'MIoT endpoint state update property is also invalidated.',
        );
      }
    }

    const invalidations = [...explicitInvalidations, ...prepared.invalidations];

    const revision = this.stateRevisionValue + 1;

    for (const {name} of invalidations) {
      this.markPropertyStateUnavailable(name);
      this.handleSnapshotPropertyInvalidated(name);
    }

    for (const {name, value} of prepared.states) {
      this.stateMap.set(name, {value, available: true});
    }

    this.readyValue = true;
    this.stateRevisionValue = revision;

    for (const {name} of invalidations) {
      this.observationRevisionMap.set(name, revision);
    }

    for (const {name} of prepared.states) {
      this.observationRevisionMap.set(name, revision);
    }

    for (const {name, value} of prepared.states) {
      this.handlePropertyStateChange(name, value);
    }

    return prepared.errors;
  }

  protected handleEvent(
    name: MiotEventSchemaNames<TEventSchema>,
    _event: MiotSpecEvent,
    _args: readonly MiotEndpointEventArgument[],
  ): void {
    throw new TypeError(`Unhandled MIoT endpoint event: ${name}.`);
  }

  /** Selects whether a resolved property participates in snapshots. */
  protected isSnapshotProperty(
    _name: string,
    _property: MiotResolvedSpecProperty,
  ): boolean {
    return true;
  }

  /** Selects snapshot properties whose buffered notifications carry deltas. */
  protected shouldReplaySnapshotPropertyNotifications(
    _name: string,
    _property: MiotResolvedSpecProperty,
  ): boolean {
    return false;
  }

  /** Selects exceptional snapshot properties to read from cloud before local fallback. */
  protected shouldPreferCloudSnapshotProperty(
    _name: string,
    _property: MiotResolvedSpecProperty,
  ): boolean {
    return false;
  }

  /** Selects events that require refreshing this endpoint's snapshot. */
  protected shouldRefreshSnapshotOnEvent(
    _name: string,
    _event: MiotSpecEvent,
  ): boolean {
    return false;
  }

  /** Handles loss of the currently valid state within the owning action. */
  protected handleStateInvalidated(): void {}

  /** Handles loss of one snapshot property within the owning action. */
  protected handleSnapshotPropertyInvalidated(_name: string): void {}

  /**
   * Handles a committed property state change.
   *
   * The value has already passed the resolved property's value validation.
   */
  protected handlePropertyStateChange(_name: string, _value: unknown): void {}

  /**
   * Marks an internal state change that did not arrive as a property or
   * event update, advancing the connection's state revision.
   */
  @action
  protected notifyStateChanged(): void {
    this.stateRevisionValue++;
  }

  /**
   * Releases local state machinery. The default implementation does nothing;
   * the owning device binding calls this when its connection is disposed.
   */
  dispose(): void {}

  abstract prepareCommand(command: TCommand): CommandExecution;

  protected getBooleanPropertyState<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
  >(name: TName): boolean | undefined;
  protected getBooleanPropertyState<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
  >(
    name: TName,
    initial: boolean,
  ): MiotEndpointConnectionPropertyState<
    MiotEndpointConnectionSchemaProperties<TSchema>[TName],
    boolean
  >;
  protected getBooleanPropertyState(
    name: string,
    initial?: boolean,
  ): boolean | undefined {
    const property = this.getProperty(name);

    if (property === undefined) {
      return undefined;
    }

    const value = this.getLastKnownPropertyState(name);

    if (value === undefined) {
      return initial;
    }

    if (typeof value !== 'boolean') {
      throw new TypeError(`Invalid MIoT boolean property state: ${name}.`);
    }

    return value;
  }

  protected getNumberPropertyState<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
  >(name: TName): number | undefined;
  protected getNumberPropertyState<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
  >(
    name: TName,
    initial: number,
  ): MiotEndpointConnectionPropertyState<
    MiotEndpointConnectionSchemaProperties<TSchema>[TName],
    number
  >;
  protected getNumberPropertyState(
    name: string,
    initial?: number,
  ): number | undefined {
    const property = this.getProperty(name);

    if (property === undefined) {
      return undefined;
    }

    const value = this.getLastKnownPropertyState(name);

    if (value === undefined) {
      return initial;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Invalid MIoT numeric property state: ${name}.`);
    }

    return value;
  }

  protected getTemperaturePropertyState<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
  >(
    name: TName,
    initial: Temperature,
  ): MiotEndpointConnectionPropertyState<
    MiotEndpointConnectionSchemaProperties<TSchema>[TName],
    Temperature
  > {
    const property = this.getProperty(name);

    if (property === undefined) {
      return undefined as MiotEndpointConnectionPropertyState<
        MiotEndpointConnectionSchemaProperties<TSchema>[TName],
        Temperature
      >;
    }

    const value = this.getLastKnownPropertyState(name);

    if (value === undefined) {
      return initial as MiotEndpointConnectionPropertyState<
        MiotEndpointConnectionSchemaProperties<TSchema>[TName],
        Temperature
      >;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Invalid MIoT numeric property state: ${name}.`);
    }

    let temperature: Temperature;

    switch (property.unit) {
      case 'celsius':
        temperature = Temperature.fromCelsius(value);
        break;
      case 'fahrenheit':
        temperature = Temperature.fromFahrenheit(value);
        break;
      case 'kelvin':
        temperature = Temperature.fromKelvin(value);
        break;
      default:
        throw new TypeError(
          `Unsupported MIoT temperature property unit: ${property.name} (${property.unit ?? 'none'}).`,
        );
    }

    return temperature as MiotEndpointConnectionPropertyState<
      MiotEndpointConnectionSchemaProperties<TSchema>[TName],
      Temperature
    >;
  }

  /**
   * Binds a device-owned codec to one resolved property in this connection.
   *
   * The physical property, raw state, and complete device URN are connection
   * concerns; concrete devices only provide the domain mapping. The returned
   * codec is cached for the connection lifetime. `read` decodes the last known
   * value, while `readAvailable` only decodes a currently available
   * observation. A codec may still be unavailable when an optional property
   * is absent or its mapping does not support this physical device.
   */
  protected getPropertyValueCodec<
    const TName extends Extract<
      keyof MiotEndpointConnectionSchemaProperties<TSchema>,
      string
    >,
    TDomain,
    TEncoded extends MiotEncodedPropertyValue,
  >(
    name: TName,
    definition: {
      readonly resolve: (context: {
        readonly deviceType: string;
        readonly property: MiotResolvedSpecProperty;
      }) =>
        | {
            readonly decode: (raw: unknown) => TDomain | undefined;
            readonly encode: (value: TDomain) => TEncoded;
          }
        | undefined;
    },
  ):
    | {
        readonly read: () => TDomain | undefined;
        readonly readAvailable: () => TDomain | undefined;
        readonly encode: (value: TDomain) => TEncoded;
      }
    | undefined {
    let codecMap = this.propertyValueCodecCache.get(definition);

    if (codecMap?.has(name)) {
      return codecMap.get(name) as
        | {
            readonly read: () => TDomain | undefined;
            readonly readAvailable: () => TDomain | undefined;
            readonly encode: (value: TDomain) => TEncoded;
          }
        | undefined;
    }

    if (codecMap === undefined) {
      codecMap = new Map();
      this.propertyValueCodecCache.set(definition, codecMap);
    }

    const property = this.getProperty(name);

    if (property === undefined) {
      codecMap.set(name, undefined);
      return undefined;
    }

    const resolved = definition.resolve({
      deviceType: this.metadata.device.urn,
      property,
    });

    if (resolved === undefined) {
      codecMap.set(name, undefined);
      return undefined;
    }

    const codec = {
      read: () => resolved.decode(this.getLastKnownPropertyState(name)),
      readAvailable: () => {
        const raw = this.getCommandEffectState(name);
        return raw === undefined ? undefined : resolved.decode(raw);
      },
      encode: (value: TDomain) => resolved.encode(value),
    };

    codecMap.set(name, codec);
    return codec;
  }

  private getLastKnownPropertyState(name: string): unknown {
    return this.stateMap.get(name)?.value;
  }

  private markPropertyStateUnavailable(name: string): void {
    const state = this.stateMap.get(name);

    if (state?.available === true) {
      this.stateMap.set(name, {...state, available: false});
    }
  }

  private createProperties(): MiotEndpointConnectionProperties {
    const properties: Record<string, MiotEndpointConnectionProperty> = {};

    for (const resource of this.metadata.resources) {
      for (const [name, property] of Object.entries(resource.properties)) {
        properties[name] = {...property, name};
      }
    }

    return properties;
  }

  private getProperty(
    name: string,
  ): MiotEndpointConnectionProperty | undefined {
    const properties: MiotEndpointConnectionProperties = this.properties;
    return properties[name];
  }

  private createEvents(): MiotEndpointConnectionEvents {
    const events: Record<string, MiotEndpointConnectionEvent> = {};

    for (const resource of this.metadata.resources) {
      for (const [name, event] of Object.entries(resource.events ?? {})) {
        events[name] = {...event, name};
      }
    }

    return events;
  }

  protected getEvent(name: string): MiotEndpointConnectionEvent | undefined {
    const events: MiotEndpointConnectionEvents = this.events;
    return events[name];
  }

  protected getPropertyValueRange(
    property: MiotEndpointConnectionProperty,
  ): MiotSpecValueRange {
    const valueRange = property['value-range'];

    if (!isValidMiotSpecValueRange(valueRange, property.format)) {
      throw new TypeError(
        `Invalid MIoT property value range: ${property.name}.`,
      );
    }

    return valueRange;
  }

  protected getPropertyValueList(
    property: MiotEndpointConnectionProperty,
  ): MiotSpecValueList {
    const valueList = property['value-list'];

    if (!isValidMiotSpecValueList(valueList)) {
      throw new TypeError(
        `Invalid MIoT property value list: ${property.name}.`,
      );
    }

    return valueList;
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

    throw createMiotEndpointConnectionError(lastUnavailableError);
  }

  private prepareStateUpdates(updates: readonly MiotPropertyUpdate[]): Array<{
    readonly name: string;
    readonly value: unknown;
    readonly property: MiotProperty;
  }> {
    const states: Array<{
      readonly name: string;
      readonly value: unknown;
      readonly property: MiotProperty;
    }> = [];
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

  private prepareSnapshotStateUpdates(updates: readonly MiotPropertyUpdate[]): {
    readonly states: Array<{
      readonly name: string;
      readonly value: unknown;
      readonly property: MiotProperty;
    }>;
    readonly invalidations: Array<{
      readonly name: string;
      readonly property: MiotProperty;
    }>;
    readonly errors: readonly Error[];
    readonly propertyKeySet: ReadonlySet<string>;
  } {
    const states: Array<{
      readonly name: string;
      readonly value: unknown;
      readonly property: MiotProperty;
    }> = [];
    const invalidations: Array<{
      readonly name: string;
      readonly property: MiotProperty;
    }> = [];
    const errors: Error[] = [];
    const stateNameSet = new Set<string>();
    const propertyKeySet = new Set<string>();

    for (const update of updates) {
      const state = this.resolveStateUpdate(update);

      if (stateNameSet.has(state.name)) {
        throw new TypeError('Duplicate MIoT endpoint property update.');
      }

      stateNameSet.add(state.name);
      propertyKeySet.add(getMiotPropertyKey(state.property));

      try {
        assertMiotPropertyValue(
          state.specProperty,
          state.value,
          state.name,
          update,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !this.isSnapshotProperty(state.name, state.specProperty)
        ) {
          throw error;
        }

        invalidations.push({name: state.name, property: state.property});
        errors.push(error);
        continue;
      }

      states.push({
        name: state.name,
        value: state.value,
        property: state.property,
      });
    }

    return {states, invalidations, errors, propertyKeySet};
  }

  private prepareSnapshotInvalidations(
    properties: readonly MiotProperty[],
  ): Array<{
    readonly name: string;
    readonly property: MiotProperty;
  }> {
    const snapshotPropertyNameMap = new Map<string, string>();

    for (const resource of this.metadata.resources) {
      for (const [name, property] of Object.entries(resource.properties)) {
        if (!this.isSnapshotProperty(name, property)) {
          continue;
        }

        snapshotPropertyNameMap.set(
          getMiotPropertyKey({
            did: this.metadata.device.did,
            siid: resource.service.iid,
            piid: property.iid,
          }),
          name,
        );
      }
    }

    const invalidations: Array<{
      readonly name: string;
      readonly property: MiotProperty;
    }> = [];
    const invalidatedPropertyKeySet = new Set<string>();

    for (const property of properties) {
      const propertyKey = getMiotPropertyKey(property);
      const name = snapshotPropertyNameMap.get(propertyKey);

      if (name === undefined) {
        throw new TypeError(
          'Unexpected MIoT endpoint snapshot invalidation property.',
        );
      } else if (invalidatedPropertyKeySet.has(propertyKey)) {
        throw new TypeError(
          'Duplicate MIoT endpoint snapshot invalidation property.',
        );
      }

      invalidatedPropertyKeySet.add(propertyKey);
      invalidations.push({name, property});
    }

    return invalidations;
  }

  private getStateUpdate(update: MiotPropertyUpdate): {
    readonly name: string;
    readonly value: unknown;
    readonly property: MiotProperty;
  } {
    const state = this.resolveStateUpdate(update);

    assertMiotPropertyValue(
      state.specProperty,
      state.value,
      state.name,
      update,
    );
    return {
      name: state.name,
      value: state.value,
      property: state.property,
    };
  }

  private resolveStateUpdate(update: MiotPropertyUpdate): {
    readonly name: string;
    readonly value: unknown;
    readonly property: MiotProperty;
    readonly specProperty: MiotResolvedSpecProperty;
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
    let stateProperty: MiotResolvedSpecProperty | undefined;

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

    return {
      name: stateName,
      value: update.value,
      property: {did: update.did, siid: update.siid, piid: update.piid},
      specProperty: stateProperty,
    };
  }

  private prepareEventNotification(update: MiotEventUpdate): {
    readonly name: MiotEventSchemaNames<TEventSchema>;
    readonly event: MiotSpecEvent;
    readonly arguments: readonly MiotEndpointEventArgument[];
  } {
    if (update.did !== this.metadata.device.did) {
      throw new TypeError('Unexpected MIoT endpoint event notification.');
    }

    const resource = this.metadata.resources.find(candidate => {
      return candidate.service.iid === update.siid;
    });

    if (resource === undefined) {
      throw new TypeError('Unexpected MIoT endpoint event notification.');
    }

    let eventName: string | undefined;
    let event: MiotSpecEvent | undefined;

    for (const [name, candidate] of Object.entries(resource.events ?? {})) {
      if (candidate.iid !== update.eiid) {
        continue;
      }

      if (eventName !== undefined) {
        throw new TypeError('Ambiguous MIoT endpoint event notification.');
      }

      eventName = name;
      event = candidate;
    }

    if (eventName === undefined || event === undefined) {
      throw new TypeError('Unexpected MIoT endpoint event notification.');
    }

    const args = resolveMiotEventArguments(resource, event, update);

    return {
      name: eventName as MiotEventSchemaNames<TEventSchema>,
      event,
      arguments: args,
    };
  }
}

/** Extracts the event schema carried by a MIoT endpoint connection type. */
export type MiotEndpointConnectionEventSchema<TConnection> =
  TConnection extends {
    readonly [MIOT_ENDPOINT_CONNECTION_EVENT_SCHEMA]: infer TEventSchema extends
      MiotEventSchema;
  }
    ? TEventSchema
    : never;

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

/**
 * Signals that a transport failed after a request may have been published.
 *
 * Unlike {@link MiotEndpointConnectionTransportUnavailableError}, this error
 * must not trigger transport fallback or automatic command retries.
 */
export class MiotEndpointConnectionTransportError extends Error {
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

export type MiotEndpointConnectionIdentityMetadata =
  EndpointConnectionMetadata &
    Readonly<x.TypeOf<typeof MiotEndpointConnectionIdentityMetadata>>;

export type LegacyMiotEndpointConnectionMetadata = EndpointConnectionMetadata &
  Readonly<x.TypeOf<typeof LegacyMiotEndpointConnectionMetadata>>;

export type MiotEndpointConnectionResource = Readonly<
  x.TypeOf<typeof MiotEndpointConnectionResource>
>;

/** A physical resource enriched with resolved endpoint property aliases. */
export type MiotEndpointConnectionResolvedResource = Omit<
  MiotEndpointConnectionResource,
  'properties'
> & {
  readonly properties: Readonly<Record<string, MiotResolvedSpecProperty>>;
  readonly events?: Readonly<Record<string, MiotSpecEvent>>;
};

export type MiotEndpointConnectionResolvedMetadata = {
  readonly device: Readonly<x.TypeOf<typeof MiotEndpointConnectionDevice>>;
  readonly resources: readonly MiotEndpointConnectionResolvedResource[];
};

type MiotEndpointConnectionProperty = MiotResolvedSpecProperty & {
  readonly name: string;
};

type MiotEndpointConnectionEvent = MiotSpecEvent & {
  readonly name: string;
};

type MiotEndpointConnectionProperties = Readonly<
  Record<string, MiotEndpointConnectionProperty | undefined>
>;

type MiotEndpointConnectionEvents = Readonly<
  Record<string, MiotEndpointConnectionEvent | undefined>
>;

type MiotEndpointConnectionSchemaProperties<
  TSchema extends MiotPropertySchema,
> = MiotPropertySchemaProperties<TSchema>;

type MiotEndpointConnectionPropertyState<TProperty, TValue> =
  undefined extends TProperty ? TValue | undefined : TValue;

export function createMiotEndpointConnectionResolvedMetadata(
  metadata: MiotEndpointConnectionMetadata,
  resources: readonly MiotEndpointConnectionResolvedResource[],
): MiotEndpointConnectionResolvedMetadata {
  const physicalResources = isLegacyMiotEndpointConnectionMetadata(metadata)
    ? metadata.resources
    : resources;
  const physicalResourceMap = new Map(
    physicalResources.map(resource => [resource.service.iid, resource]),
  );
  const resolvedServiceIidSet = new Set<number>();
  const stateNameSet = new Set<string>();
  const propertyKeySet = new Set<string>();
  const eventNameSet = new Set<string>();
  const eventKeySet = new Set<string>();

  if (
    isLegacyMiotEndpointConnectionMetadata(metadata) &&
    resources.length !== metadata.resources.length
  ) {
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

    for (const [name, event] of Object.entries(resource.events ?? {})) {
      const eventKey = JSON.stringify([resource.service.iid, event.iid]);

      if (eventNameSet.has(name) || eventKeySet.has(eventKey)) {
        throw new TypeError('Ambiguous resolved MIoT endpoint event.');
      }

      if (
        !physicalResource.service.events?.some(candidate =>
          miotSpecEventsEqual(candidate, event),
        )
      ) {
        throw new TypeError(
          'Resolved MIoT endpoint event does not belong to its service.',
        );
      }

      eventNameSet.add(name);
      eventKeySet.add(eventKey);
    }

    return {
      service: physicalResource.service,
      properties: resource.properties,
      ...(resource.events !== undefined && {events: resource.events}),
    };
  });

  return {device: metadata.device, resources: resolvedResources};
}

export function isLegacyMiotEndpointConnectionMetadata(
  metadata: MiotEndpointConnectionMetadata,
): metadata is LegacyMiotEndpointConnectionMetadata {
  return metadata.version === undefined;
}

export type MiotPropertyUpdate = MiotProperty & {
  readonly value: unknown;
};

export type MiotEndpointNotificationTarget =
  | {
      readonly type: 'property-change';
      readonly data: MiotProperty;
    }
  | {
      readonly type: 'event';
      readonly data: MiotEvent;
    };

export type MiotEndpointNotification =
  | {
      readonly type: 'property-change';
      readonly data: MiotPropertyUpdate;
    }
  | {
      readonly type: 'event';
      readonly data: MiotEventUpdate;
    };

export type MiotEndpointStateUpdate = {
  readonly did: string;
  readonly online: boolean;
  readonly properties: readonly MiotPropertyUpdate[];
  readonly invalidatedProperties?: readonly MiotProperty[];
};

/** One raw event argument paired with its resolved property metadata. */
export type MiotEndpointEventArgument = {
  readonly property: MiotSpecProperty;
  readonly value: unknown;
};

export type MiotEventUpdate = MiotEvent & {
  readonly arguments: MiotEventArguments;
};

function resolveMiotEventArguments(
  resource: MiotEndpointConnectionResolvedResource,
  event: MiotSpecEvent,
  update: MiotEventUpdate,
): readonly MiotEndpointEventArgument[] {
  const expectedPiidSet = new Set(event.arguments);

  if (
    expectedPiidSet.size !== event.arguments.length ||
    update.arguments.data.length !== event.arguments.length
  ) {
    throw new TypeError('Invalid MIoT endpoint event notification arguments.');
  }

  const argumentMap = resolveMiotEventArgumentMap(
    update.arguments,
    event.arguments,
    expectedPiidSet,
  );

  return event.arguments.map(piid => {
    const argument = argumentMap.get(piid);
    const physicalProperties = (resource.service.properties ?? []).filter(
      property => property.iid === piid,
    );
    const [physicalProperty] = physicalProperties;

    if (argument === undefined || physicalProperties.length !== 1) {
      throw new TypeError(
        'Invalid MIoT endpoint event notification arguments.',
      );
    }

    const resolvedProperties = Object.values(resource.properties).filter(
      property => property.iid === piid,
    );

    if (resolvedProperties.length > 1) {
      throw new TypeError(
        'Ambiguous MIoT endpoint event notification argument.',
      );
    }

    const property = resolvedProperties[0] ?? physicalProperty;

    if (property === undefined) {
      throw new TypeError(
        'Invalid MIoT endpoint event notification arguments.',
      );
    }

    return {
      property,
      value: argument.value,
    };
  });
}

function resolveMiotEventArgumentMap(
  values: MiotEventArguments,
  expectedPiids: readonly number[],
  expectedPiidSet: ReadonlySet<number>,
): ReadonlyMap<number, MiotEventArgument> {
  if (values.data.length !== expectedPiids.length) {
    throw new TypeError('Invalid MIoT endpoint event notification arguments.');
  }

  if (values.type === 'positional') {
    return new Map(
      expectedPiids.map((piid, index) => [
        piid,
        {piid, value: values.data[index]},
      ]),
    );
  }

  if (values.type !== 'identified') {
    throw new TypeError('Invalid MIoT endpoint event notification arguments.');
  }

  const argumentMap = new Map<number, MiotEventArgument>();

  for (const value of values.data) {
    if (
      !isMiotEventArgument(value) ||
      !expectedPiidSet.has(value.piid) ||
      argumentMap.has(value.piid)
    ) {
      throw new TypeError(
        'Invalid MIoT endpoint event notification arguments.',
      );
    }

    argumentMap.set(value.piid, value);
  }

  return argumentMap;
}

function isMiotEventArgument(value: unknown): value is MiotEventArgument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const argument = value as {readonly piid?: unknown};

  return (
    typeof argument.piid === 'number' &&
    Number.isInteger(argument.piid) &&
    argument.piid > 0 &&
    Object.hasOwn(value, 'value')
  );
}

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

function miotSpecEventsEqual(
  left: MiotSpecEvent,
  right: MiotSpecEvent,
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
  left: {readonly service: {readonly iid: number}},
  right: {readonly service: {readonly iid: number}},
): number {
  return left.service.iid - right.service.iid;
}

function getMiotPropertyKey(property: MiotProperty): string {
  return JSON.stringify([property.did, property.siid, property.piid]);
}

function createMiotEndpointConnectionTransportError(
  error: unknown,
): MiotEndpointConnectionTransportError {
  const message =
    error instanceof Error
      ? `MIoT transport failed: ${error.message}`
      : 'MIoT transport failed.';
  return new MiotEndpointConnectionTransportError(message);
}

function createMiotEndpointConnectionError(
  error: unknown,
): EndpointConnectionError {
  const message =
    error instanceof Error
      ? `MIoT transport failed: ${error.message}`
      : 'MIoT transport failed.';
  return new EndpointConnectionError(message);
}

function assertMiotPropertyValue(
  property: MiotResolvedSpecProperty,
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

    if (!Object.hasOwn(MIOT_NUMERIC_FORMAT_RANGES, format)) {
      throw new TypeError(`Unsupported MIoT property state format: ${format}.`);
    }

    if (/^(?:u?int(?:8|16|32))$/.test(format) && !Number.isInteger(value)) {
      throw new TypeError('Invalid MIoT integer property state.');
    }

    const formatRange = MIOT_NUMERIC_FORMAT_RANGES[format];

    if (
      formatRange !== undefined &&
      (value < formatRange[0] || value > formatRange[1])
    ) {
      throw new TypeError('MIoT property state exceeds its format range.');
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
