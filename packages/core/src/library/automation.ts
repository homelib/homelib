import type {NamedObject} from '@homelib/x';
import {types} from '@homelib/x';
import type {CronExpression} from 'cron-parser';
import {CronExpressionParser} from 'cron-parser';
import {autorun, computed, reaction} from 'mobx';

import type {
  ConfigDeclarationsToConfigs,
  UnknownConfigDeclarations,
} from './config.js';
import type {
  DeviceDeclarationsToDeviceBindings,
  DeviceDeclarationsToDeviceEndpoints,
  DeviceEndpoint,
  UnknownDevice,
  UnknownDeviceDeclarations,
} from './device/index.js';
import type {DeviceQuery} from './device-query.js';
import type {Scope} from './scope.js';
import {$constructor} from './utils/index.js';
import type {AutomationName} from './x/index.js';

export type AutomationAutomateCallback<TAutomation extends Automation> = (
  context: AutomationCallbackContext<TAutomation>,
) => () => void;

export abstract class Automation implements NamedObject<string> {
  declare [types]: {
    name: string;
    scope: Scope;
    devices: {};
    configs: {};
  };

  readonly name: AutomationName;

  _scope: Scope | undefined;

  private callbacks: AutomationAutomateCallback<Automation>[] = [];

  private deviceDeclarations: UnknownDeviceDeclarations | undefined;

  private bindings:
    | Record<string, DeviceQuery<Scope, UnknownDevice>[]>
    | undefined;

  constructor(name: string) {
    this.name = name as AutomationName;
  }

  devices<const TDeviceDeclarations extends UnknownDeviceDeclarations>(
    devices: TDeviceDeclarations,
  ): this & {
    [types]: {
      devices: TDeviceDeclarations;
    };
  };
  devices(devices: UnknownDeviceDeclarations): this {
    this.deviceDeclarations = devices;

    return this;
  }

  configs<const TConfigDeclarations extends UnknownConfigDeclarations>(
    configs: TConfigDeclarations,
  ): this & {
    [types]: {
      configs: TConfigDeclarations;
    };
  };
  configs(configs: UnknownConfigDeclarations): this {
    return this;
  }

  automate(callback: AutomationAutomateCallback<this>): this {
    this.callbacks.push(callback);

    return this;
  }

  bind<TScope extends Scope>(
    devices: DeviceDeclarationsToDeviceBindings<this[types]['devices'], TScope>,
  ): this & {
    [types]: {
      scope: TScope;
    };
  };
  bind(devices: Record<string, unknown>): this {
    this.bindings = Object.fromEntries(
      Object.entries(devices).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : [value],
      ]),
    );

    return this;
  }

  _up(): void {
    const scope = this._requireScope();
    const declarations = this._requireDeviceDeclarations();
    const bindings = this._requireDeviceBindings();

    const deviceMap = new Map<string, UnknownDevice | UnknownDevice[]>();

    for (const [key, declaration] of Object.entries(declarations)) {
      const deviceIterator = scope._queryDevices(bindings[key]);

      if (typeof declaration === 'function') {
        for (const device of deviceIterator) {
          if (device instanceof declaration) {
            deviceMap.set(key, device);
            break;
          }
        }
      } else if (Array.isArray(declaration)) {
        const devices: UnknownDevice[] = new Array(declaration.length);

        let remaining = declaration.length;

        for (const device of deviceIterator) {
          const index = declaration.findIndex(
            DeviceClass =>
              typeof DeviceClass === 'function' &&
              device instanceof DeviceClass,
          );

          if (index < 0 || devices[index]) {
            continue;
          }

          devices[index] = device;

          if (--remaining === 0) {
            break;
          }
        }

        deviceMap.set(key, devices);
      } else if ('class' in declaration && declaration.multiple) {
        const {class: DeviceClass, multiple} = declaration;

        console.assert(multiple);

        const devices = Array.from(deviceIterator).filter(
          device => device instanceof DeviceClass,
        );

        deviceMap.set(key, devices);
      } else {
        throw new Error(
          `Invalid device declaration for key ${JSON.stringify(key)} under scope ${JSON.stringify(scope._path)}.`,
        );
      }
    }

    let disposers: (() => void)[] = [];

    reaction(
      () =>
        Object.fromEntries(
          deviceMap
            .entries()
            .map(([key, deviceOrDevices]) => [
              key,
              Array.isArray(deviceOrDevices)
                ? deviceOrDevices.map(device => device._endpoint)
                : deviceOrDevices._endpoint,
            ]),
        ),
      endpoints => {
        for (const dispose of disposers) {
          dispose();
        }

        disposers = this.callbacks.map(callback =>
          callback({
            devices: endpoints,
            configs: undefined!,
          }),
        );
      },
    );
  }

  _requireScope(): Scope {
    const scope = this._scope;

    if (!scope) {
      throw new Error('Automation not added to a scope.');
    }

    return scope;
  }

  _requireDeviceDeclarations(): UnknownDeviceDeclarations {
    const deviceDeclarations = this.deviceDeclarations;

    if (!deviceDeclarations) {
      throw new Error('Automation has no device declarations.');
    }

    return deviceDeclarations;
  }

  _requireDeviceBindings(): Record<
    string,
    DeviceQuery<Scope, UnknownDevice>[]
  > {
    const bindings = this.bindings;

    if (!bindings) {
      throw new Error('Automation not bound to devices.');
    }

    return bindings;
  }
}

export const $automation = $constructor(Automation);

export type AutomationWithScope<TScope extends Scope> = Automation & {
  [types]: {
    scope: TScope;
  };
};

export type AutomationCallbackContext<TAutomation extends Automation> = {
  devices: DeviceDeclarationsToDeviceEndpoints<TAutomation[types]['devices']>;
  configs: ConfigDeclarationsToConfigs<TAutomation[types]['configs']>;
};
