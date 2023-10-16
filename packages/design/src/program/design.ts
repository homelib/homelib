import {$, $area, $floor, $home, $room} from '@homelib/core';
import {
  $cameraStream,
  CameraStream,
  Light,
  SecurityCameraPlugin,
} from '@homelib/universal';
import {XiaomiPlugin} from '@homelib/xiaomi';

import {
  AmbientLightAutomation,
  ColorTemperatureSensor,
  $ambientLightAutomation,
} from './@ambient-light-automation.js';

export default $home('新家')
  .scopes({
    f1: $floor('一楼').scopes({
      'living-room': $room('客厅').scopes({
        'working-area': $area('工作区').devices({
          lights: {
            class: Light,
            multiple: true,
          },
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
    xiaomi: new XiaomiPlugin(),
    cctv: new SecurityCameraPlugin(),
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
    'ambient-light': {
      automation: $ambientLightAutomation(),
      devices: {
        lights: $('living-room', 'lights', Light),
        colorTemperatureSensor: $(ColorTemperatureSensor),
      },
    },
  });
