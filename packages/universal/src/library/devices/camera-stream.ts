import {$constructor, Device, DeviceEndpoint} from '@homelib/core';

export type CameraStreamOptions = {
  source: string;
};

export class CameraStream extends Device<CameraStreamEndpoint> {
  readonly type = '@homelib/universal/camera-stream';

  constructor(name: string, options: CameraStreamOptions) {
    super(name, {});
  }

  override connect(): CameraStreamEndpoint | Promise<CameraStreamEndpoint> {
    throw new Error('Method not implemented.');
  }
}

export class CameraStreamEndpoint extends DeviceEndpoint {
  override dispose(): Promise<void> | void {
    throw new Error('Method not implemented.');
  }
}

export const $cameraStream = $constructor(CameraStream);
