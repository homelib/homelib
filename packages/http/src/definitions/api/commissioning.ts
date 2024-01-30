import {x} from '@homelib/x';

import {define} from '../@definition.js';

export const commission = define(
  x.object({
    pairingCode: x.string,
  }),
  x.object({}),
);
