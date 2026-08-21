import type {
  MiotEncodedPropertyValue,
  MiotPropertyValue,
  MiotResolvedSpecProperty,
} from '../../miot/index.js';

/** A device-specific value codec bound to one resolved physical property. */
export type MiotResolvedPropertyValueCodec<
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
export type MiotPropertyValueCodec<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  readonly resolve: (context: {
    readonly deviceType: string;
    readonly property: MiotResolvedSpecProperty;
  }) => MiotResolvedPropertyValueCodec<TDomain, TRaw> | undefined;
};
