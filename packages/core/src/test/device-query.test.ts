/* eslint-disable @typescript-eslint/ban-ts-comment */
import type {DeviceQuery} from '../library/index.js';
import {$} from '../library/index.js';

import type {Light, Television} from './@device-cases/index.js';
import type {home1} from './@scope-cases/index.js';

test('types', () => {
  $() satisfies DeviceQuery<Light, home1>;
  $('living-room') satisfies DeviceQuery<Light, home1>;
  $('living-room', 'balcony') satisfies DeviceQuery<Light, home1>;
  $('balcony') satisfies DeviceQuery<Light, home1>;
  $('bedroom') satisfies DeviceQuery<Light, home1>;
  $(
    'bedroom',
    'level-2',
    'level-3',
    'level-4',
    'level-5',
    'level-6',
    'level-7',
  ) satisfies DeviceQuery<Light, home1>;
  $(
    // @ts-expect-error
    'bedroom',
    'level-2',
    'level-3',
    'level-4',
    'level-5',
    'level-6',
    'level-7',
    'level-8',
  ) satisfies DeviceQuery<Light, home1>;
  $('bedroom', 'duplicate') satisfies DeviceQuery<Light, home1>;
  $('bedroom', 'duplicate', 'duplicate') satisfies DeviceQuery<Light, home1>;
  // @ts-expect-error
  $('bedroom', 'duplicate', 'duplicate', 'duplicate') satisfies DeviceQuery<
    Light,
    home1
  >;
  // @ts-expect-error
  $('outdoor') satisfies DeviceQuery<Light, home1>;

  // @ts-expect-error
  $() satisfies DeviceQuery<Television, home1>;
  // @ts-expect-error
  $('balcony') satisfies DeviceQuery<Television, home1>;
});
