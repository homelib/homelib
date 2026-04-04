import {$constructor, Device, DeviceEndpoint} from '@homelib/core';

export class Light extends Device<LightEndpoint> {
  readonly type = '@homelib/universal/light';

  override async connect(): Promise<LightEndpoint> {
    return new LightEndpoint();
  }
}

export class LightEndpoint extends DeviceEndpoint {
  get on(): boolean | undefined {
    return undefined;
  }

  async toggle(on?: boolean): Promise<void> {}

  override dispose(): void {}
}

export const $light = $constructor(Light);
