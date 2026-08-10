import type {Command} from '../command.js';
import type {DeviceEntry} from '../device.js';
import type {Endpoint} from '../endpoint.js';
import type {Scope, ScopePath} from '../scope.js';

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

export type EndpointPath = {
  readonly scopePath: ScopePath;
  readonly deviceName: string;
  readonly endpointName: string;
};
