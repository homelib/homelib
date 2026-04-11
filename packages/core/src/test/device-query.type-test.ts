import type {DeviceQuery} from '../library/index.js';
import {$} from '../library/index.js';

import type {Light, Television} from './@device-cases/index.js';
import type {home_1} from './@scope-cases/index.js';

$() satisfies DeviceQuery<home_1, Light>;

$('Living Room', 'Light') satisfies DeviceQuery<home_1, Light>;

// @ts-expect-error path should move on
$('Living Room', 'Light', 'Light') satisfies DeviceQuery<home_1, Light>;

$('Living Room') satisfies DeviceQuery<home_1, Light>;

$('Living Room', 'Balcony') satisfies DeviceQuery<home_1, Light>;

$('Balcony') satisfies DeviceQuery<home_1, Light>;

$('Bedroom') satisfies DeviceQuery<home_1, Light>;

// @ts-expect-error bedroom is not in living room
$('Living Room', 'Bedroom') satisfies DeviceQuery<home_1, Light>;

$(
  'Bedroom',
  'Level 2',
  'Level 3',
  'Level 4',
  'Level 5',
  'Level 6',
  'Level 7',
) satisfies DeviceQuery<home_1, Light>;

$(
  // @ts-expect-error there's no level 8
  'Bedroom',
  'Level 2',
  'Level 3',
  'Level 4',
  'Level 5',
  'Level 6',
  'Level 7',
  'Level 8',
) satisfies DeviceQuery<home_1, Light>;

$('Bedroom', 'Duplicate') satisfies DeviceQuery<home_1, Light>;

$('Bedroom', 'Duplicate', 'Duplicate') satisfies DeviceQuery<home_1, Light>;

// @ts-expect-error only 2 levels of duplicate
$('Bedroom', 'Duplicate', 'Duplicate', 'Duplicate') satisfies DeviceQuery<
  home_1,
  Light
>;

// @ts-expect-error no such scope
$('Outdoor') satisfies DeviceQuery<home_1, Light>;

// @ts-expect-error no television in home_1
$() satisfies DeviceQuery<Television, home_1>;

// @ts-expect-error no television in balcony
$('Balcony') satisfies DeviceQuery<Television, home_1>;
