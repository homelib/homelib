import {$home, bootstrap} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

import {setupTemperatureHumidityControl} from './@temperature-humidity-control.js';

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 客厅 = 美岸.$scope('客厅');

const 客厅空调 = 客厅.$airConditioner('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

await bootstrap();

setupTemperatureHumidityControl(客厅空调, 客厅除湿机);
