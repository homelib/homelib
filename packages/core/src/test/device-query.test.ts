/* eslint-disable @typescript-eslint/ban-ts-comment */
import type {DeviceQuery} from '../library/index.js';
import {$} from '../library/index.js';

import type {Light, Television} from './@device-cases/index.js';
import type {home1} from './@scope-cases/index.js';

test('types', () => {
  $() satisfies DeviceQuery<home1, Light>;
  $('Living Room') satisfies DeviceQuery<home1, Light>;
  $('Living Room', 'Balcony') satisfies DeviceQuery<home1, Light>;
  $('Balcony') satisfies DeviceQuery<home1, Light>;
  $('Bedroom') satisfies DeviceQuery<home1, Light>;
  $(
    'Bedroom',
    'Level 2',
    'Level 3',
    'Level 4',
    'Level 5',
    'Level 6',
    'Level 7',
  ) satisfies DeviceQuery<home1, Light>;
  $(
    // @ts-expect-error
    'Bedroom',
    'Level 2',
    'Level 3',
    'Level 4',
    'Level 5',
    'Level 6',
    'Level 7',
    'Level 8',
  ) satisfies DeviceQuery<home1, Light>;
  $('Bedroom', 'Duplicate') satisfies DeviceQuery<home1, Light>;
  $('Bedroom', 'Duplicate', 'Duplicate') satisfies DeviceQuery<home1, Light>;
  // @ts-expect-error
  $('Bedroom', 'Duplicate', 'Duplicate', 'Duplicate') satisfies DeviceQuery<
    home1,
    Light
  >;
  // @ts-expect-error
  $('outdoor') satisfies DeviceQuery<home1, Light>;

  // @ts-expect-error
  $() satisfies DeviceQuery<Television, home1>;
  // @ts-expect-error
  $('Balcony') satisfies DeviceQuery<Television, home1>;
});
