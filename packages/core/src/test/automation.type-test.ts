import type {AssertTrue, IsEqual} from 'tslang';

import {$, $automation} from '../library/index.js';

import {Light, Television} from './@device-cases/index.js';
import type {home_1} from './@scope-cases/index.js';

const $automation_1 = $automation.build(automation =>
  automation
    .devices({
      lights: {
        class: Light,
        multiple: true,
      },
      tv: Television,
      someTuple: [Light, Television],
    })
    .configs({
      mode: {
        type: 'mode',
        values: ['day', 'night'],
      },
    })
    .start(({devices: {lights, tv, someTuple}, configs: {mode}}) => {
      type _assert =
        | AssertTrue<IsEqual<typeof lights, Light[]>>
        | AssertTrue<IsEqual<typeof tv, Television>>
        | AssertTrue<
            IsEqual<
              typeof someTuple,
              readonly [Light, Television]
            >
          >
        | AssertTrue<IsEqual<typeof mode, 'day' | 'night'>>;
    })
    .react(({devices: {lights, tv, someTuple}, configs: {mode}}) => {
      type _assert =
        | AssertTrue<IsEqual<typeof lights, Light[]>>
        | AssertTrue<IsEqual<typeof tv, Television>>
        | AssertTrue<
            IsEqual<
              typeof someTuple,
              readonly [Light, Television]
            >
          >
        | AssertTrue<IsEqual<typeof mode, 'day' | 'night'>>;
    }),
);

$automation_1('Automation 1').bind<home_1>({
  lights: [$('Balcony')],
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});

$automation_1('Automation 1').bind<home_1>({
  lights: $('Balcony'),
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});

$automation_1('Automation 1').bind<home_1>(
  // @ts-expect-error missing someTuple
  {
    lights: $('Balcony'),
    tv: $('Living Room'),
  },
);

$automation_1('Automation 1').bind<home_1>({
  // @ts-expect-error no bedroom in balcony
  lights: $('Balcony', 'Bedroom'),
  // @ts-expect-error no television in balcony
  tv: $('Balcony'),
  someTuple: [
    // @ts-expect-error no bedroom in balcony
    $('Balcony', 'Bedroom'),
    $('Living Room'),
  ],
});

$automation_1('Automation 1').bind<home_1>({
  lights: [
    // @ts-expect-error no bedroom in balcony
    $('Balcony', 'Bedroom'),
  ],
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});
