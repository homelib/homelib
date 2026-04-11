import type {DeviceName} from '@homelib/core';
import {$constructor, Device, DeviceEndpoint} from '@homelib/core';

export type CameraStreamOptions = {
  source: string;
};

export class CameraStream extends Device<CameraStreamEndpoint> {
  readonly type = '@homelib/universal/camera-stream';

  constructor(name: string, options: CameraStreamOptions) {
    super(name as DeviceName, {});
  }
}

export class CameraStreamEndpoint extends DeviceEndpoint {
  override dispose(): Promise<void> | void {
    throw new Error('Method not implemented.');
  }
}

export const $cameraStream = $constructor(CameraStream);
