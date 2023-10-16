import type {Configuration} from './configuration.js';
import type {Device} from './device.js';

export class Automation {
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

export function $automation<
  TDevices extends Record<string, AutomationDeviceDeclaration>,
>(devices: TDevices): Automation {
  return new Automation();
}
