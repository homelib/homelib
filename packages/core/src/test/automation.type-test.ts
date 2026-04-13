import type {AssertTrue, IsEqual} from 'tslang';

import {$, $automation} from '../library/index.js';

import type {LightEndpoint, TelevisionEndpoint} from './@devices/index.js';
import {Light, Television} from './@devices/index.js';
import type {home_1} from './@scopes/index.js';

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
    .automate(({devices: {lights, tv, someTuple}, configs: {mode}}) => {
      type _assert =
        | AssertTrue<IsEqual<typeof lights, LightEndpoint[]>>
        | AssertTrue<IsEqual<typeof tv, TelevisionEndpoint>>
        | AssertTrue<
            IsEqual<
              typeof someTuple,
              readonly [LightEndpoint, TelevisionEndpoint]
            >
          >
        | AssertTrue<IsEqual<typeof mode, 'day' | 'night'>>;

      return () => {};
    }),
);

$automation_1('Automation 1').bind<home_1>({
  lights: [$('Balcony')],
  tv: $('Television'),
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
    tv: $('Living Room', 'Television'),
  },
);

$automation_1('Automation 1').bind<home_1>({
  // @ts-expect-error no bedroom in balcony
  lights: $('Balcony', 'Bedroom'),
  // @ts-expect-error no television in level 2
  tv: $('Level 2'),
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
  // @ts-expect-error no television in bedroom
  tv: $('Bedroom'),
  someTuple: [$('Balcony'), $()],
});
