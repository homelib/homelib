import {register} from '@homelib/core';
import {
  registerProviderBindingComponent,
  registerProviderDetailsComponent,
} from '@homelib/terminal';

import {MiotPlaceholderDevice} from './devices/index.js';
import {MIOT_NAMESPACE, MiotProvider} from './provider.js';
import {MiotProviderBindings, MiotProviderDetails} from './terminal/index.js';

register(MIOT_NAMESPACE, {
  placeholder: MiotPlaceholderDevice,
});
registerProviderBindingComponent(MiotProvider, MiotProviderBindings);
registerProviderDetailsComponent(MiotProvider, MiotProviderDetails);

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {
      miot: MiotDeviceConstructors;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface MiotDeviceConstructors {
      placeholder: MiotPlaceholderDevice;
    }
  }
}

export * from './backend/index.js';
export * from './binding.js';
export * from './cloud/index.js';
export * from './command.js';
export * from './configuration.js';
export * from './devices/index.js';
export * from './endpoint-adapter.js';
export * from './endpoint-connection.js';
export * from './local/index.js';
export * from './miot/index.js';
export * from './provider.js';
export * from './session-manager.js';
export * from './session.js';
export * from './storage.js';
export * from './terminal/index.js';
