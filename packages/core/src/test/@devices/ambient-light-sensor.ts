import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class AmbientLightSensor extends Device<AmbientLightSensorEndpoint> {
  readonly type = 'ambient-light-sensor';
}

export class AmbientLightSensorEndpoint extends DeviceEndpoint {
  get lux$(): number {
    return 0;
  }

  get colorTemperature$(): number {
    return 0;
  }
  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $ambientLightSensor = $constructor(AmbientLightSensor);
