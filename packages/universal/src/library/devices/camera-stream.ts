import {$constructor, Device, device_type, types} from '@homelib/core';

export type CameraStreamOptions = {
  source: string;
};

export class CameraStream extends Device {
  declare [device_type]: '@homelib/universal/camera-stream';

  constructor(name: string, options: CameraStreamOptions) {
    super(name, {});
  }

  test(): void {}
}

export const $cameraStream = $constructor(CameraStream);
