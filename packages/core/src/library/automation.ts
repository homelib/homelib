import type {NamedObject} from '@homelib/x';
import {types} from '@homelib/x';
import type {CronExpression} from 'cron-parser';
import {CronExpressionParser} from 'cron-parser';
import {computed} from 'mobx';

import type {
  ConfigDeclarationsToConfigs,
  UnknownConfigDeclarations,
} from './config.js';
import type {
  DeviceDeclarationsToDeviceBindings,
  DeviceDeclarationsToDeviceEndpoints,
  UnknownDevice,
  UnknownDeviceDeclarations,
} from './device/index.js';
import type {DeviceQuery} from './device-query.js';
import type {Scope} from './scope.js';
import {$constructor} from './utils/index.js';
import type {AutomationName} from './x/index.js';

export abstract class Automation implements NamedObject<string> {
  declare [types]: {
    name: string;
    scope: Scope;
    devices: {};
    configs: {};
  };

  readonly name: AutomationName;

  _scope: Scope | undefined;

  private starts: ((context: AutomationCallbackContext<Automation>) => void)[] =
    [];

  private reacts: ((context: AutomationCallbackContext<Automation>) => void)[] =
    [];

  private schedules: {
    crons: CronExpression[];
    callbacks: ((context: AutomationCallbackContext<Automation>) => void)[];
    lastRanAt?: Date;
  }[] = [];

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

  start(callback: (context: AutomationCallbackContext<this>) => void): this {
    this.starts.push(callback);

    return this;
  }

  react(callback: (context: AutomationCallbackContext<this>) => void): this {
    this.reacts.push(callback);

    return this;
  }

  schedule(
    cronExpression: string | string[],
    callback: (context: AutomationCallbackContext<this>) => void,
  ): this {
    const crons = (
      Array.isArray(cronExpression) ? cronExpression : [cronExpression]
    ).map(cronExpression => CronExpressionParser.parse(cronExpression));

    this.schedules.push({crons, callbacks: [callback]});

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
    const devices = computed(() => {
      const scope = this._requireScope();
      const bindings = this._requireBindings();
    });
  }

  _requireScope(): Scope {
    const scope = this._scope;

    if (!scope) {
      throw new Error('Automation not added to a scope.');
    }

    return scope;
  }

  _requireBindings(): Record<string, DeviceQuery<Scope, UnknownDevice>[]> {
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
