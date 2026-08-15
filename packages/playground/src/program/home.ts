import {$home, bootstrap} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {$xiaomi} from '@homelib/xiaomi';

import {setupTemperatureHumidityControl} from './@temperature-humidity-control.js';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 客厅 = 美岸.$scope('客厅');

const 客厅空调 = 客厅.$airConditioner('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

const 客厅温湿度传感器 = 客厅.$temperatureHumiditySensor('温湿度传感器');

const 主卧 = 美岸.$scope('主卧');

const 主卧空调 = 主卧.$airConditioner('空调');
const 主卧除湿机 = 主卧.$dehumidifier('除湿机');

const 主卧温湿度传感器 = 主卧.$temperatureHumiditySensor('温湿度传感器');

await bootstrap();

setupTemperatureHumidityControl('客厅', {
  airConditioner: 客厅空调,
  dehumidifier: 客厅除湿机,
  onGetter: () => 客厅空调.on,
  temperature: {
    sensor: 客厅除湿机,
    idealApparentTemperatureUpperLimit: 27,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.5,
  },
  humidity: {
    sensor: 客厅除湿机,
    idealRelativeHumidityUpperLimit: 0.55,
    idealRelativeHumidityLowerLimit: 0.45,
    idealRelativeHumidityTolerance: 0.05,
  },
});

setupTemperatureHumidityControl('主卧', {
  airConditioner: 主卧空调,
  dehumidifier: 主卧除湿机,
  onGetter: () => 主卧空调.on,
  temperature: {
    sensor: 主卧除湿机,
    idealApparentTemperatureUpperLimit: 27,
    idealApparentTemperatureLowerLimit: 20,
    idealTemperatureTolerance: 0.5,
  },
  humidity: {
    sensor: 主卧除湿机,
    idealRelativeHumidityUpperLimit: 0.55,
    idealRelativeHumidityLowerLimit: 0.45,
    idealRelativeHumidityTolerance: 0.05,
  },
});

autorun(() => {
  if (!客厅温湿度传感器.ready) {
    return;
  }

  console.info('客厅温湿度传感器', {
    temperature: 客厅温湿度传感器.temperature,
    relativeHumidity: 客厅温湿度传感器.relativeHumidity,
  });
});

autorun(() => {
  if (!主卧温湿度传感器.ready) {
    return;
  }

  console.info('主卧温湿度传感器', {
    temperature: 主卧温湿度传感器.temperature,
    relativeHumidity: 主卧温湿度传感器.relativeHumidity,
  });
});
