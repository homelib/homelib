import {setTimeout} from 'node:timers/promises';

import {$home, bootstrap} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 餐厅 = 美岸.$scope('餐厅');
const 餐厅大灯 = 餐厅.$light('大灯');
const 餐厅小灯 = 餐厅.$light('小灯');

const 客厅 = 美岸.$scope('客厅');
const 客厅大灯 = 客厅.$light('大灯');
const 客厅小灯 = 客厅.$light('小灯');
const 客厅空调 = 客厅.$airConditioner('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

await bootstrap();

const idealTemperatureUpperLimit = 26;
const idealTemperatureLowerLimit = 20;
const idealHumidityUpperLimit = 0.5;
const idealHumidityLowerLimit = 0.45;

const idealTemperatureDeviation = 0.5;
const idealHumidityDeviation = 0.02;

const temperatureState = 0;
const humidityState = 0;

while (true) {
  await setTimeout(5000);

  if (
    客厅除湿机.temperature === undefined ||
    客厅除湿机.humidity === undefined
  ) {
    continue;
  }

  const temperature = 客厅除湿机.temperature.celsius;
  const humidity = 客厅除湿机.humidity;

  console.log('温度:', temperature);
  console.log('湿度:', humidity);

  if (
    temperature > idealTemperatureUpperLimit &&
    humidity > idealHumidityUpperLimit
  ) {
    客厅空调.setMode('dry');
  }

  // 1. 温度高，湿度高：只开空调除湿。
  // 2. 温度高，湿度不高：只开空调制冷。
  // 3. 温度不高，湿度高：空调制冷 + 除湿机除湿。
}
