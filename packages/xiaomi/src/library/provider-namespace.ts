import {register} from '@homelib/core';

import {MiotLight} from './devices/index.js';
import {MIOT_NAMESPACE} from './provider.js';

register(MIOT_NAMESPACE, {
  light: MiotLight,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {
      miot: MiotDeviceConstructors;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface MiotDeviceConstructors {
      light: MiotLight;
    }
  }
}

export {};
