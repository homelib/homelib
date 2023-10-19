import type {Automation, AutomationWithScope} from '../automation.js';
import type {Device} from '../device.js';
import type {Plugin} from '../plugin.js';
import type {
  NamedObject,
  NamedTupleToRecord,
  UnknownNamedObject,
} from '../types.js';
import {types} from '../types.js';
import {$constructor} from '../utils/index.js';

export class Scope implements UnknownNamedObject {
  declare [types]: {
    name: string;
    scopes: {};
    devices: {};
  };

  readonly name: this[types]['name'];

  constructor(name: string) {
    this.name = name;
  }

  scopes<const TScopes extends readonly Scope[]>(
    scopes: TScopes,
  ): this & {
    [types]: {
      scopes: NamedTupleToRecord<TScopes>;
    };
  };
  scopes(scopes: Scope[]): this {
    return this;
  }

  plugins(plugins: Plugin[]): this {
    return this;
  }

  devices<const TDevices extends readonly Device[]>(
    devices: TDevices,
  ): this & {
    [types]: {
      devices: NamedTupleToRecord<TDevices>;
    };
  };
  devices(devices: Device[]): this {
    return this;
  }

  automations(automations: AutomationWithScope<this>[]): this {
    return this;
  }
}

export const $scope = $constructor(Scope);
