import {$constructor, Device} from '@homelib/core';

export type CameraStreamOptions = {
  source: string;
};

export class CameraStream extends Device {
  readonly type = '@homelib/universal/camera-stream';

  constructor(name: string, options: CameraStreamOptions) {
    super(name, {});
  }

}


export const $cameraStream = $constructor(CameraStream);
