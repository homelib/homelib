import {$, $area, $home, $room, $scope} from '../../library/index.js';
import {$ambientLightSensor, $light} from '../@device-cases/index.js';

import {$ambientLightAutomation} from './@automations/index.js';

const home = $home('新家')
  .scopes([
    $room('客厅').scopes([
      $area('工作区').devices([$light('主灯'), $light('台灯')]),
      $area('餐厅'),
    ]),
    $room('卧室').scopes([$area('阳台')]),
    $scope('室外').devices([$ambientLightSensor('室外环境光传感器')]),
  ])
  // .plugins([$xiaomiPlugin(), $cctvPlugin()])
  .devices([
    // $cctvCamera('室外摄像头 1', {
    //   source: 'rtsp://...',
    // }),
    // $cctvCamera('室外摄像头 2', {
    //   source: 'rtsp://...',
    // }),
  ])
  .automations([
    $ambientLightAutomation.bind({
      lights: $(),
      ambientLightSensor: $(),
    }),
  ]);
// .cards([
//   $lightCard('客厅主灯').binds({
//     light: $('客厅', '主灯'),
//   }),
// ]);
