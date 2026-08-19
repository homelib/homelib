import {$home, bootstrap} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

import {setupAutoPetFeeding} from './@auto-pet-feeding.js';
import {setupBathroomVentilation} from './@bathroom-ventilation.js';
import {setupDehumidifierWaterTankReminder} from './@dehumidifier-water-tank-reminder.js';
import {setupMotionActivatedLighting} from './@motion-activated-lighting.js';
import {setupTemperatureHumidityControl} from './@temperature-humidity-control.js';

$xiaomi('美岸');

const 美岸 = $home('美岸', home =>
  home
    .$scope('客厅', room =>
      room
        .$airConditioner('空调')
        .$dehumidifier('除湿机')
        .$temperatureHumiditySensor('温湿度传感器')
        .$petFeeder('宠物喂食器')
        .$smartSpeaker('小爱音箱')
        .$light('大灯')
        .$light('小灯'),
    )
    .$scope('主卧', room =>
      room
        .$airConditioner('空调')
        .$dehumidifier('除湿机')
        .$temperatureHumiditySensor('温湿度传感器')
        .$smartSpeaker('小爱音箱'),
    )
    .$scope('卫生间', room => room.$switch('灯').$bathHeater('浴霸'))
    .$scope('卫生间走廊', corridor =>
      corridor.$light('灯组').$motionAmbientLightLevelSensor('运动传感器'),
    ),
);

await bootstrap();

setupTemperatureHumidityControl('客厅', {
  airConditioner: 美岸.客厅.空调,
  dehumidifier: 美岸.客厅.除湿机,
  temperature: {
    sensor: 美岸.客厅.温湿度传感器,
    idealApparentTemperatureUpperLimit: 30,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.3,
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
  temperature: {
    sensor: 美岸.主卧.温湿度传感器,
    idealApparentTemperatureUpperLimit: 30,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.3,
  },
  humidity: {
    sensor: 美岸.主卧.温湿度传感器,
    idealRelativeHumidityUpperLimit: 0.55,
    idealRelativeHumidityLowerLimit: 0.45,
    idealRelativeHumidityTolerance: 0.05,
  },
});

setupAutoPetFeeding(美岸.客厅.宠物喂食器);

setupBathroomVentilation(美岸.卫生间.灯, 美岸.卫生间.浴霸);

setupDehumidifierWaterTankReminder({
  lights: [美岸.客厅.大灯, 美岸.客厅.小灯],
  dehumidifier: 美岸.客厅.除湿机,
  speaker: 美岸.客厅.小爱音箱,
});

setupMotionActivatedLighting(美岸.卫生间走廊.运动传感器, 美岸.卫生间走廊.灯组);
