import {
  MotionSensorEndpoint,
  type MotionSensorEndpointConnection,
} from '@homelib/core';

import type {MiotEventSchema, MiotPropertySchema} from '../miot/index.js';

import {MiotMotionSensorEndpointConnectionBase} from './@motion-sensor.js';

export class MiotMotionSensorEndpointConnection
  extends MiotMotionSensorEndpointConnectionBase<
    typeof MiotMotionSensorEndpointConnection.properties
  >
  implements MotionSensorEndpointConnection
{
  static readonly Endpoint = MotionSensorEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:motion-sensor:00007825': {
      'urn:miot-spec-v2:property:no-motion-duration:000000CB': {
        name: 'no-motion-duration',
        optional: true,
        'value-list': {
          // The official lumi-bmgl01 instance spec omits 0, while the device
          // reports it right after motion; Xiaomi's official HA integration
          // patches the same value in.
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
}
