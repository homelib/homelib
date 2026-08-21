import {encodeMiotPropertyValue} from '../../miot/index.js';

import type {MiotPropertyValueCodec} from './codec.js';

export const NORMALIZED_PERCENTAGE_PROPERTY_CODEC: MiotPropertyValueCodec<
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
