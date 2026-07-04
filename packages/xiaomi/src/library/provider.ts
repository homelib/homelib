import type {DeviceConnection} from '@homelib/core';
import {Provider} from '@homelib/core';

export class MiotProvider extends Provider<never> {
  override get deviceConnections(): DeviceConnection<never>[] {
    throw new Error('Method not implemented.');
  }
}
