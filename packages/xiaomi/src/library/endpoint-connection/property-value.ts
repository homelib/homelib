import type {
  MiotEncodedPropertyValue,
  MiotPropertyValue,
  MiotResolvedSpecProperty,
} from '../miot/index.js';

/** Converts between domain values and one resolved physical MIoT property. */
export type MiotPropertyValueCodec<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  /** Returns undefined when a physically valid raw value has no domain value. */
  readonly decode: (raw: unknown) => TDomain | undefined;

  /** Encodes one domain value into a canonical physical MIoT value. */
  readonly encode: (value: TDomain) => MiotEncodedPropertyValue<TRaw>;
};

/**
 * A device-owned codec definition that resolves against the complete device
 * URN and an already-resolved physical property.
 */
export type MiotPropertyValueCodecDefinition<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  readonly resolve: (context: {
    readonly deviceType: string;
    readonly property: MiotResolvedSpecProperty;
  }) => MiotPropertyValueCodec<TDomain, TRaw> | undefined;
};

/** A resolved codec bound to property state in one endpoint connection. */
export type MiotPropertyValueBinding<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  /** Decodes the last known value, including an unavailable observation. */
  readonly read: () => TDomain | undefined;

  /** Decodes only a currently available observation. */
  readonly readAvailable: () => TDomain | undefined;

  /** Encodes one domain value through the resolved property codec. */
  readonly encode: (value: TDomain) => MiotEncodedPropertyValue<TRaw>;
};
