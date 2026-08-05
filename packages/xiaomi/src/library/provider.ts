import type {EndpointConnection} from '@homelib/core';
import {$constructor, Provider, register} from '@homelib/core';

import type {MiotCommand} from './command.js';

export class MiotProvider extends Provider<MiotCommand> {
  override get endpointConnections(): EndpointConnection<MiotCommand>[] {
    throw new Error('Method not implemented.');
  }
}

export const $xiaomi = $constructor(MiotProvider).build(provider => {
  register(provider);
});
