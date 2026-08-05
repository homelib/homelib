import {register} from '@homelib/core';

import {MiotLight} from './devices/index.js';

register('miot', {
  light: MiotLight,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {
      miot: MiotDeviceConstructors;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface MiotDeviceConstructors {}
  }
}

export {};
