import {$, $area, $floor, $home, $room} from '@homelib/core';
import {$cameraStream, $light, $securityCameraPlugin} from '@homelib/universal';
import {$xiaomiPlugin} from '@homelib/xiaomi';

import {$ambientLightAutomation} from './@ambient-light-automation.js';

export default $home('新家')
  .scopes({
    f1: $floor('一楼')
      .devices({
        lights: $light('主灯'),
      })
      .scopes({
        'living-room': $room('客厅').scopes({
          'working-area': $area('工作区').devices({
            lights: $light('工作区灯'),
          }),
          'dining-area': $area('餐厅'),
        }),
        bedroom: $room('卧室').scopes({
          balcony: $area('阳台'),
        }),
      }),
  })
  // plugin may contain multiple functionalities.
  .plugins({
    xiaomi: $xiaomiPlugin(),
    cctv: $securityCameraPlugin(),
  })
  .devices({
    'outdoor-cctv-1': $cameraStream('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    'outdoor-cctv-2': $cameraStream('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  })
  .automations({
    'ambient-light': $ambientLightAutomation().bind({
      lights: [$('f1', 'lights'), $('living-room', 'lights')],
      colorTemperatureSensor: $(),
      test: [$(), $()],
    }),
  });
