import {$constructor, Device} from '@homelib/core';

export interface CameraStreamOptions {
  source: string;
}

export class CameraStream extends Device {
  constructor(name: string, options: CameraStreamOptions) {
    super(name, {});
  }

  test(): void {}
}

export const $cameraStream = $constructor(CameraStream);
