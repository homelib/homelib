import {setTimeout} from 'node:timers/promises';

import {$home, run} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 餐厅 = 美岸.$scope('餐厅');
const 餐厅大灯 = 餐厅.$light('大灯');
const 餐厅小灯 = 餐厅.$light('小灯');

const 客厅 = 美岸.$scope('客厅');
const 客厅大灯 = 客厅.$light('大灯');
const 客厅小灯 = 客厅.$light('小灯');
const 客厅空调 = 客厅.$ac('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

void (async () => {
  while (true) {
    console.log('客厅除湿机湿度:', 客厅除湿机.humidity);
    console.log('客厅除湿机温度:', 客厅除湿机.temperature);

    await setTimeout(5000);
  }
})();

await run();
