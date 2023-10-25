import {fileURLToPath} from 'url';

import {$, $constructor, Card} from '../library/index.js';

import {Light, Television} from './@device-cases/index.js';
import type {home_1} from './@scope-cases/index.js';

const $lightCard = $constructor(
  class LightCard extends Card {
    constructor(name: string) {
      super(name, '@homelib/universal/cards/light-card');
    }
  },
).build(card =>
  card.devices({
    lights: {
      class: Light,
      multiple: true,
    },
    tv: Television,
    someTuple: [Light, Television],
  }),
);

const lightCard_1 = $lightCard('Light Card 1');

lightCard_1.bind<home_1>({
  lights: [$('Balcony')],
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});

lightCard_1.bind<home_1>({
  lights: $('Balcony'),
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});

lightCard_1.bind<home_1>(
  // @ts-expect-error missing someTuple
  {
    lights: $('Balcony'),
    tv: $('Living Room'),
  },
);

lightCard_1.bind<home_1>({
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

lightCard_1.bind<home_1>({
  lights: [
    // @ts-expect-error no bedroom in balcony
    $('Balcony', 'Bedroom'),
  ],
  tv: $('Living Room'),
  someTuple: [$('Balcony'), $()],
});
