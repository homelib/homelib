import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class Television extends Device<TelevisionEndpoint> {
  readonly type = 'television';
}

export class TelevisionEndpoint extends DeviceEndpoint {
  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $television = $constructor(Television);
