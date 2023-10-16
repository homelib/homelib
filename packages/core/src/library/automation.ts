import type {Configuration} from './configuration.js';
import type {Device} from './device.js';
import {$constructor} from './utils/index.js';

export class Automation<
  TDeviceDeclarations extends Record<string, AutomationDeviceDeclaration>,
> {
  devices<
    const TDeviceDeclarations extends Record<
      string,
      AutomationDeviceDeclaration
    >,
  >(devices: TDeviceDeclarations): Automation<TDeviceDeclarations> {
    return this;
  }

  configurable(configs: Record<string, Configuration>): this {
    throw new Error('Not implemented');
  }

  setup(reaction: (devices: any, configs: any) => void): this {
    throw new Error('Not implemented');
  }

  reaction(reaction: (devices: any, configs: any) => void): this {
    throw new Error('Not implemented');
  }
}

export type AutomationDeviceDeclaration =
  | typeof Device
  | (typeof Device)[]
  | {
      class: typeof Device;
      multiple: true;
    };

export const $automation = $constructor(Automation);
