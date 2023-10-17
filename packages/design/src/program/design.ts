import {$, $area, $floor, $home, $room} from '@homelib/core';
import {$cameraStream, $light, $securityCameraPlugin} from '@homelib/universal';
import {$xiaomiPlugin} from '@homelib/xiaomi';

import {$ambientLightAutomation} from './@ambient-light-automation.js';

export default $home('My Home')
  .scopes({
    f1: $floor('Floor 1')
      .devices({
        lights: $light('Main Light'),
      })
      .scopes({
        'living-room': $room('Living Room').scopes({
          'working-area': $area('Working Area').devices({
            lights: $light('Main Light'),
          }),
          'dining-area': $area('Dining Area'),
        }),
        bedroom: $room('Bedroom').scopes({
          balcony: $area('Balcony'),
        }),
      }),
    f2: $floor('Floor 2'),
  })
  .devices({
    'outdoor-cctv-1': $cameraStream('Outdoor CCTV 1', {
      source: 'rtsp://...',
    }),
    'outdoor-cctv-2': $cameraStream('Outdoor CCTV 2', {
      source: 'rtsp://...',
    }),
  })
  // plugin may contain multiple functionalities.
  .plugins({
    xiaomi: $xiaomiPlugin(),
    cctv: $securityCameraPlugin(),
  })
  .automations({
    'ambient-light': $ambientLightAutomation().bind({
      lights: [$('f1', 'bedroom', 'balcony'), $('f2')],
      colorTemperatureSensor: $(),
      test: [$(), $()],
    }),
  });
