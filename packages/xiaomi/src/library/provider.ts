import type {EndpointConnection} from '@homelib/core';
import {$constructor, Provider, register} from '@homelib/core';

import type {MiotEndpointCommand} from './command.js';

export class MiotProvider extends Provider<MiotEndpointCommand> {
  override get endpointConnections(): EndpointConnection<MiotEndpointCommand>[] {
    throw new Error('Method not implemented.');
  }
}

export const $xiaomi = $constructor(MiotProvider).build(provider => {
  register(provider);
});
