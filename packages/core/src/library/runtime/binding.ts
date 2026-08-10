import * as x from 'x-value';

import type {Command} from '../command.js';
import type {DeviceEntry} from '../device.js';
import type {Endpoint} from '../endpoint.js';
import {ProviderName} from '../provider.js';
import {type Scope, ScopePath} from '../scope.js';

export const EndpointPath = x.object({
  scopePath: ScopePath,
  deviceName: x.string,
  endpointName: x.string,
});

export type EndpointPath = Readonly<x.TypeOf<typeof EndpointPath>>;

export const ProviderReference = x.object({
  namespace: x.string,
  name: ProviderName,
});

export type ProviderReference = Readonly<x.TypeOf<typeof ProviderReference>>;

export const EndpointBinding = x.object({
  endpoint: EndpointPath,
  provider: ProviderReference,
  metadata: x.unknown,
});

export type EndpointBinding = Readonly<x.TypeOf<typeof EndpointBinding>>;

export const BindingFile = x.object({
  version: x.literal(0),
  bindings: x.array(EndpointBinding),
});

export type BindingFile = Readonly<x.TypeOf<typeof BindingFile>>;

export function getEndpointPath(
  scope: Scope,
  deviceEntry: DeviceEntry,
  endpoint: Endpoint<Command>,
): EndpointPath {
  return {
    scopePath: scope.path,
    deviceName: deviceEntry.name,
    endpointName: endpoint.name,
  };
}
