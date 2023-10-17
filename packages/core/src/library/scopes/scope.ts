import type {Automation} from '../automation.js';
import type {Device, DevicesConstraint} from '../device.js';
import {types} from '../types.js';
import {$constructor} from '../utils/index.js';

export class Scope {
  declare [types]: {
    devices: DevicesConstraint;
    scopes: Record<string, Scope>;
  };

  constructor(readonly name: string) {}

  scopes<const TScopes extends ScopesConstraint>(
    scopes: TScopes,
  ): this & {
    [types]: {
      scopes: TScopes;
    };
  };
  scopes(scopes: ScopesConstraint): this {
    return this;
  }

  plugins(plugins: Record<string, unknown>): this {
    return this;
  }

  devices<const TDeviceDescriptors extends DevicesConstraint>(
    devices: TDeviceDescriptors,
  ): this & {
    [types]: {
      devices: TDeviceDescriptors;
    };
  };
  devices(devices: DevicesConstraint): this {
    return this;
  }

  automations(automations: Record<string, Automation>): this {
    return this;
  }
}

export const $scope = $constructor(Scope);

export type ScopesConstraint = Record<string, Scope>;
