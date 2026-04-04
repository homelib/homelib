import {$constructor, Device, DeviceEndpoint} from '../../library/index.js';

export class AmbientLightSensor extends Device<AmbientLightSensorEndpoint> {
  readonly type = 'ambient-light-sensor';

  override connect(): AmbientLightSensorEndpoint {
    throw new Error('Method not implemented.');
  }
}

export class AmbientLightSensorEndpoint extends DeviceEndpoint {
  override dispose(): void {
    throw new Error('Method not implemented.');
  }

  get lux$(): number {
    return 0;
  }

  get colorTemperature$(): number {
    return 0;
  }
}

export const $ambientLightSensor = $constructor(AmbientLightSensor);
