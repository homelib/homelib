import type {MiotPropertyValueCodecDefinition} from '../../endpoint-connection/index.js';
import {encodeMiotPropertyValue} from '../../miot/index.js';

export const NORMALIZED_PERCENTAGE_PROPERTY_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  number,
  number
> = {
  resolve({property}) {
    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? raw / 100
          : undefined;
      },
      encode(value) {
        return encodeMiotPropertyValue(property, value * 100);
      },
    };
  },
};
