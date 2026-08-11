import {$home} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('my home');

const home = $home('my home');

const livingRoom = home.$scope('living room');

livingRoom.$light('main light').turnOn();

const bedroom = home.$scope('bedroom');

bedroom.$light('night light').turnOff();
