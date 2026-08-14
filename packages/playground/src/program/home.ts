import {$home, bootstrap} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

import {setupTemperatureHumidityControl} from './@temperature-humidity-control.js';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 客厅 = 美岸.$scope('客厅');

const 客厅空调 = 客厅.$airConditioner('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

const 主卧 = 美岸.$scope('主卧');

const 主卧空调 = 主卧.$airConditioner('空调');
const 主卧除湿机 = 主卧.$dehumidifier('除湿机');

await bootstrap();

setupTemperatureHumidityControl('客厅', {
  temperatureSensor: 客厅除湿机,
  humiditySensor: 客厅除湿机,
  airConditioner: 客厅空调,
  dehumidifier: 客厅除湿机,
  onGetter: () => 客厅空调.on,
});

setupTemperatureHumidityControl('主卧', {
  temperatureSensor: 主卧除湿机,
  humiditySensor: 主卧除湿机,
  airConditioner: 主卧空调,
  dehumidifier: 主卧除湿机,
  idealTemperatureTolerance: 0.5,
  idealRelativeHumidityTolerance: 0.05,
  onGetter: () => 主卧空调.on,
});
