import type {PetFeeder} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {createKeepAlive, debounce} from '@homelib/utils';
import ms from 'ms';

const RECENT_LOWEST_FOOD_WEIGHTS_TIME_WINDOW = ms('12h');
const AUTORUN_KEEP_ALIVE_INTERVAL = ms('3h');

const FOOD_WEIGHT_LOW_THRESHOLD = 3;

export function setupAutoPetFeeding(宠物喂食器: PetFeeder): void {
  const recentLowestFoodWeights: {
    time: number;
    weight: number;
  }[] = [];

  const dispense = debounce(() => {
    宠物喂食器.dispense(1);
  }, ms('10m'));

  const keepAlive = createKeepAlive(AUTORUN_KEEP_ALIVE_INTERVAL);

  autorun(() => {
    if (!宠物喂食器.ready || 宠物喂食器.bowlFoodWeight === undefined) {
      return;
    }

    keepAlive();

    console.info('宠物喂食器', {
      foodLevel: 宠物喂食器.foodLevel,
      bowlFoodWeight: 宠物喂食器.bowlFoodWeight,
    });

    const now = Date.now();

    recentLowestFoodWeights.push({
      time: now,
      weight: 宠物喂食器.bowlFoodWeight,
    });

    while (
      recentLowestFoodWeights.length > 0 &&
      recentLowestFoodWeights[0].time <
        now - RECENT_LOWEST_FOOD_WEIGHTS_TIME_WINDOW
    ) {
      recentLowestFoodWeights.shift();
    }

    const lowestFoodWeight = Math.min(
      ...recentLowestFoodWeights.map(item => item.weight),
    );

    if (
      宠物喂食器.bowlFoodWeight <
      lowestFoodWeight + FOOD_WEIGHT_LOW_THRESHOLD
    ) {
      dispense();
    }
  });
}
