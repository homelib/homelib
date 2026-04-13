import EventEmitter from 'node:events';

import type {DeviceId} from '../x/index.js';

export abstract class DeviceEndpoint extends EventEmitter {
  constructor(readonly id: DeviceId) {
    super();
  }

  abstract dispose(): Promise<void> | void;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface DeviceEndpoint {
  on(event: 'dispose', listener: () => void): this;
  once(event: 'dispose', listener: () => void): this;
}
