import {$home, run} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('美岸');

const home = $home('美岸');

const diningRoom = home.$scope('餐厅');

const light = diningRoom.$light('大灯');

light.turnOff();

await run();
