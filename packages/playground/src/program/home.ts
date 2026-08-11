import {setTimeout} from 'node:timers/promises';

import {$home, run} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 餐厅 = 美岸.$scope('餐厅');

const 餐厅大灯 = 餐厅.$light('大灯');
const 餐厅小灯 = 餐厅.$light('小灯');

void (async () => {
  while (true) {
    if (餐厅大灯.on) {
      餐厅大灯.turnOff();
      餐厅小灯.turnOff();
    } else {
      餐厅大灯.turnOn();
      餐厅小灯.turnOn();
    }

    await setTimeout(5000);
  }
})();

await run();
