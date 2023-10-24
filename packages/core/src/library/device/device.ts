import type {EndpointNumber, NodeId} from '@project-chip/matter.js/datatype';
import type {Endpoint} from '@project-chip/matter.js/device';
import type {Nominal} from 'x-value';

import type {UnknownConfigDeclarations} from '../config.js';
import type {Scope} from '../scope.js';
import type {NamedObject} from '../types.js';
import {types} from '../types.js';

import type {DeviceEndpoint} from './device-endpoint.js';

export type DeviceOptions = {
  configs: UnknownConfigDeclarations;
};

export abstract class Device<TDeviceEndpoint extends DeviceEndpoint>
  implements NamedObject<string>
{
  declare [types]: {
    name: string;
  };

  abstract readonly type: string;

  readonly options: DeviceOptions;

  _scope: Scope | undefined;

  _key: DeviceKey | undefined;

  constructor(
    readonly name: string,
    options: Partial<DeviceOptions> = {},
  ) {
    const {configs = {}} = options;

    this.options = {configs};
  }

  configs(configs: UnknownConfigDeclarations): this {
    this.options.configs = configs;
    return this;
  }

  abstract connect(
    endpoint: Endpoint,
  ): Promise<TDeviceEndpoint> | TDeviceEndpoint;

  _requireScope(): Scope {
    const scope = this._scope;

    if (!scope) {
      throw new Error('Device not added to a scope.');
    }

    return scope;
  }
}

export type DeviceKey = Nominal<'device key', string>;

export function DEVICE_KEY(nodeId: NodeId, path: EndpointNumber[]): DeviceKey {
  return `${nodeId}:${path.join('.')}` as DeviceKey;
}

export type UnknownDevice = Device<DeviceEndpoint>;

export type DeviceConstructor<TDeviceEndpoint extends DeviceEndpoint> =
  typeof Device<TDeviceEndpoint>;

export type UnknownDeviceConstructor = typeof Device<DeviceEndpoint>;
