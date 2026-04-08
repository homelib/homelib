import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class Feeder extends Device<FeederEndpoint> {
  readonly type = 'feeder';
}

export class FeederEndpoint extends DeviceEndpoint {
  feed(): void {
    throw new Error('Method not implemented.');
  }

  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $feeder = $constructor(Feeder);
