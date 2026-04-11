import type {types} from '@homelib/x';
import type {AssertFalse, AssertTrue, IsEqual} from 'tslang';

import type {
  DeviceDeclarationToDeviceEndpoint,
  NextQueryForDevice,
  ScopeTreeForDevice,
} from '../../library/index.js';
import {
  $,
  $area,
  $automation,
  $home,
  $room,
  $scope,
} from '../../library/index.js';
import type {Light} from '../@device-cases/index.js';
import {
  $ambientLightSensor,
  $feeder,
  $light,
  $lightSwitchAutomation,
  $switch,
  Feeder,
} from '../@device-cases/index.js';

import {$ambientLightAutomation} from './@automations/index.js';

const feederAutomation = $automation('喂食器自动化')
  .devices({
    feeder: Feeder,
  })
  .schedule('0 8 * * *', ({devices: {feeder}}) => {
    feeder.feed();
  });

const home = $home('新家')
  .scopes([
    $room('客厅').scopes([
      $area('工作区')
        .devices([$light('主灯'), $switch('主灯开关'), $light('台灯')])
        .automations([
          $lightSwitchAutomation('主灯开关').bind({
            lights: $('主灯'),
            switches: $('主灯开关'),
          }),
        ]),
      $area('餐厅'),
    ]),
    $room('卧室').scopes([$area('阳台')]),
  ])
  // .plugins([$xiaomiPlugin(), $cctvPlugin()])
  .devices([
    $feeder('喂食器'),
    $ambientLightSensor('室外环境光传感器'),
    // $cctvCamera('室外摄像头 1', {
    //   source: 'rtsp://...',
    // }),
    // $cctvCamera('室外摄像头 2', {
    //   source: 'rtsp://...',
    // }),
  ])
  .automations([
    $ambientLightAutomation('环境光自动化').bind({
      lights: [$('客厅', '台灯'), $('客厅', '主灯')],
      ambientLightSensor: $(),
    }),
    feederAutomation.bind({
      feeder: $(),
    }),
  ]);
// .cards([
//   $lightCard('客厅主灯').binds({
//     light: $('客厅', '主灯'),
//   }),
// ]);

type home = typeof home;

type HomeTree = ScopeTreeForDevice<home, Light>;

type QNext1 = NextQueryForDevice<home, Light, ['客厅']>;

type QNext2 = NextQueryForDevice<home, Light, ['客厅', '主灯']>;

type _assert =
  | AssertFalse<IsEqual<QNext2, '主灯' | '台灯'>>
  | AssertTrue<IsEqual<QNext2, never>>;
