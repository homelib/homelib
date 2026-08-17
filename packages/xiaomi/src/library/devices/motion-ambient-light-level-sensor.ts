import {
  type AmbientLightLevel,
  MotionAmbientLightLevelSensorEndpoint,
  type MotionAmbientLightLevelSensorEndpointConnection,
} from '@homelib/core';
import {computed, observable} from 'mobx';

import type {
  MiotEventArgument,
  MiotEventSchema,
  MiotPropertySchema,
  MiotSpecEvent,
} from '../miot/index.js';

import {MiotMotionSensorEndpointConnectionBase} from './@motion-sensor.js';

/** Xiaomi Motion Sensor 2 (lumi.motion.bmgl01), including ambient light level. */
export class MiotMotionAmbientLightLevelSensorEndpointConnection
  extends MiotMotionSensorEndpointConnectionBase<
    typeof MiotMotionAmbientLightLevelSensorEndpointConnection.properties
  >
  implements MotionAmbientLightLevelSensorEndpointConnection
{
  static readonly Endpoint = MotionAmbientLightLevelSensorEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:motion-sensor:00007825': {
      'urn:miot-spec-v2:property:illumination:0000004E': {
        name: 'ambient-light-level',
        access: 'read',
        enum: {
          'urn:miot-spec-v2:device:motion-sensor:0000A014:lumi-bmgl01:1': {
            low: 1,
            high: 2,
          },
        },
        iid: {
          'urn:miot-spec-v2:device:motion-sensor:0000A014:lumi-bmgl01:1': 1,
        },
      },
      'urn:miot-spec-v2:property:no-motion-duration:000000CB': {
        name: 'no-motion-duration',
        optional: true,
        'value-list': {
          'urn:miot-spec-v2:device:motion-sensor:0000A014:lumi-bmgl01:1': [
            {value: 0, description: '0 Seconds'},
            {value: 2, description: '2 Minutes'},
            {value: 5, description: '5 Minutes'},
          ],
        },
      },
    },
  } as const satisfies MiotPropertySchema;

  static readonly events = {
    'urn:miot-spec-v2:service:motion-sensor:00007825': {
      'urn:miot-spec-v2:event:motion-detected:00005001': 'motion-detected',
    },
  } as const satisfies MiotEventSchema;

  @observable private accessor ambientLightLevelRefreshedForMotion = false;

  /** The qualitative ambient light level sampled for detected motion. */
  @computed
  get ambientLightLevel(): AmbientLightLevel | undefined {
    return this.motionDetected === true &&
      this.ambientLightLevelRefreshedForMotion
      ? this.getEnumPropertyState('ambient-light-level')
      : undefined;
  }

  protected override handleSnapshotPropertyInvalidated(name: string): void {
    if (name === 'ambient-light-level') {
      this.ambientLightLevelRefreshedForMotion = false;
    }
  }

  protected override handleEvent(
    name: string,
    event: MiotSpecEvent,
    arguments_: readonly MiotEventArgument[],
  ): void {
    super.handleEvent(name, event, arguments_);
    this.ambientLightLevelRefreshedForMotion = true;
  }

  protected override handlePropertyStateChange(
    name: string,
    value: unknown,
  ): void {
    const motionWasDetected = this.motionDetected === true;

    super.handlePropertyStateChange(name, value);

    if (name === 'no-motion-duration' && (value !== 0 || !motionWasDetected)) {
      this.ambientLightLevelRefreshedForMotion = false;
    }
  }

  protected override handleStateInvalidated(): void {
    super.handleStateInvalidated();
    this.ambientLightLevelRefreshedForMotion = false;
  }

  protected override shouldRefreshSnapshotOnEvent(
    name: string,
    _event: MiotSpecEvent,
  ): boolean {
    return name === 'motion-detected';
  }
}
