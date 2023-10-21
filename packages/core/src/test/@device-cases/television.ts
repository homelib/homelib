import {DeviceEndpoint, $constructor, Device} from '../../library/index.js';

export class Television extends Device<TelevisionEndpoint> {
  readonly type = 'television';

  override connect(): TelevisionEndpoint {
    throw new Error('Method not implemented.');
  }
}

export class TelevisionEndpoint extends DeviceEndpoint {
  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $television = $constructor(Television);
