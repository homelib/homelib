import {$constructor, Device, DeviceEndpoint} from '@homelib/core';

export class Light extends Device<LightEndpoint> {
  readonly type = '@homelib/universal/light';
}

export const $light = $constructor(Light);

export abstract class LightEndpoint extends DeviceEndpoint {
  abstract get on$(): boolean | undefined;

  abstract toggle(on?: boolean): Promise<void>;
}

export class MatterLightEndpoint extends LightEndpoint {
  override get on$(): boolean | undefined {
    return undefined;
  }

  override async toggle(on?: boolean): Promise<void> {}

  override dispose(): Promise<void> | void {
    throw new Error('Method not implemented.');
  }
}
