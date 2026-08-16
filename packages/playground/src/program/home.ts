import {$home, bootstrap} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {$xiaomi} from '@homelib/xiaomi';

import {setupAutoPetFeeding} from './@auto-pet-feeding.js';
import {setupTemperatureHumidityControl} from './@temperature-humidity-control.js';

$xiaomi('美岸');

const 美岸 = $home('美岸', home =>
  home
    .$scope('客厅', room =>
      room
        .$airConditioner('空调')
        .$dehumidifier('除湿机')
        .$temperatureHumiditySensor('温湿度传感器')
        .$petFeeder('宠物喂食器'),
    )
    .$scope('主卧', room =>
      room
        .$airConditioner('空调')
        .$dehumidifier('除湿机')
        .$temperatureHumiditySensor('温湿度传感器'),
    )
    .$scope('卫生间走廊', corridor => corridor.$motionSensor('运动传感器')),
);

await bootstrap();

setupTemperatureHumidityControl('客厅', {
  airConditioner: 美岸.客厅.空调,
  dehumidifier: 美岸.客厅.除湿机,
  onGetter: () => 美岸.客厅.空调.on,
  temperature: {
    sensor: 美岸.客厅.温湿度传感器,
    idealApparentTemperatureUpperLimit: 28,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.5,
  },
  humidity: {
    sensor: 美岸.客厅.温湿度传感器,
    idealRelativeHumidityUpperLimit: 0.55,
    idealRelativeHumidityLowerLimit: 0.45,
    idealRelativeHumidityTolerance: 0.05,
  },
});

setupTemperatureHumidityControl('主卧', {
  airConditioner: 美岸.主卧.空调,
  dehumidifier: 美岸.主卧.除湿机,
  onGetter: () => 美岸.主卧.空调.on,
  temperature: {
    sensor: 美岸.主卧.温湿度传感器,
    idealApparentTemperatureUpperLimit: 28,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.5,
  },
  humidity: {
    sensor: 美岸.主卧.温湿度传感器,
    idealRelativeHumidityUpperLimit: 0.55,
    idealRelativeHumidityLowerLimit: 0.45,
    idealRelativeHumidityTolerance: 0.05,
  },
});

setupAutoPetFeeding(美岸.客厅.宠物喂食器);

autorun(() => {
  if (!美岸.卫生间走廊.运动传感器.ready) {
    return;
  }

  console.info('卫生间走廊运动传感器', {
    motionDetected: 美岸.卫生间走廊.运动传感器.motionDetected,
  });
});
