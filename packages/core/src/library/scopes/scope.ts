import type {Device} from '../device.js';
import {$constructor} from '../utils/index.js';

export class Scope {
  constructor(readonly name: string) {}

  scopes(scopes: Record<string, Scope>): this {
    return this;
  }

  plugins(plugins: Record<string, unknown>): this {
    return this;
  }

  devices(devices: Record<string, Device>): this {
    return this;
  }

  automations(automations: Record<string, unknown>): this {
    return this;
  }
}

export const $scope = $constructor(Scope);
