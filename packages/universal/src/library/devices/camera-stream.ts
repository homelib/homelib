import {$constructor, Device, DeviceEndpoint, types} from '@homelib/core';

export type CameraStreamOptions = {
  source: string;
};

export class CameraStream extends Device<CameraStreamEndpoint> {
  readonly type = '@homelib/universal/camera-stream';

  constructor(name: string, options: CameraStreamOptions) {
    super(name, {});
  }

  override connect(): CameraStreamEndpoint {
    throw new Error('Method not implemented.');
  }
}

export class CameraStreamEndpoint extends DeviceEndpoint {
  dispose(): void {}
}

export const $cameraStream = $constructor(CameraStream);
