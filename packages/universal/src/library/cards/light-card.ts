import {$constructor, Card} from '@homelib/core';

import {Light} from '../devices/index.js';

export const $lightCard = $constructor(
  class LightCard extends Card {
    constructor(name: string) {
      super(name, '@homelib/universal/cards/light-card');
    }
  },
).build(card =>
  card.devices({
    light: Light,
  }),
);

export type LightCard = ReturnType<typeof $lightCard>;
