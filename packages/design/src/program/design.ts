import {$, $area, $floor, $home, $room} from '@homelib/core';
import {$cameraStream, $light, $securityCameraPlugin} from '@homelib/universal';
import {$xiaomiPlugin} from '@homelib/xiaomi';

import {
  $ambientLightAutomation,
  $colorTemperatureSensor,
} from './@ambient-light-automation.js';

export default $home('My Home')
  .scopes([
    $floor('Floor 1')
      .scopes([
        $room('Living Room').scopes([
          $area('Working Area').devices([$light('Main Light')]),
          $area('Dining Area'),
        ]),
        $room('Bedroom').scopes([$area('Balcony')]),
      ])
      .devices([$light('Main Light')]),
    $floor('Floor 2').devices([
      $light('Main Light'),
      $colorTemperatureSensor('Main Light'),
    ]),
  ])
  .devices([
    $cameraStream('Outdoor CCTV 1', {
      source: 'rtsp://...',
    }),
    $cameraStream('Outdoor CCTV 2', {
      source: 'rtsp://...',
    }),
  ])
  // plugin may contain multiple functionalities.
  .plugins([$xiaomiPlugin(), $securityCameraPlugin()])
  .automations([
    $ambientLightAutomation('Amazing Ambient Light').bind({
      lights: [$('Floor 1', 'Working Area'), $()],
      colorTemperatureSensor: $('Floor 2'),
      test: [$('Floor 1', 'Living Room'), $()],
    }),
  ]);
