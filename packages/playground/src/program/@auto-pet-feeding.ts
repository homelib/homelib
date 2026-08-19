import {type PetFeeder, autorun} from '@homelib/core';
import {createHeartbeat, debounce} from '@homelib/utils';
import ms from 'ms';

const RECENT_LOWEST_FOOD_WEIGHTS_TIME_WINDOW = ms('12h');
const AUTORUN_HEARTBEAT_INTERVAL = ms('3h');

const FOOD_WEIGHT_LOW_THRESHOLD = 3;

export function setupAutoPetFeeding(feeder: PetFeeder): void {
  const recentLowestFoodWeights: {
    time: number;
    weight: number;
  }[] = [
    {
      time: Date.now(),
      weight: 0,
    },
  ];

  const dispense = debounce(() => {
    feeder.dispense(1);
  }, ms('10m'));

  const heartbeat = createHeartbeat(AUTORUN_HEARTBEAT_INTERVAL);

  autorun(() => {
    if (!feeder.ready || feeder.bowlFoodWeight === undefined) {
      return;
    }

    heartbeat();

    const now = Date.now();

    recentLowestFoodWeights.push({
      time: now,
      weight: feeder.bowlFoodWeight,
    });

    while (
      recentLowestFoodWeights.length > 1 &&
      recentLowestFoodWeights[0].time <
        now - RECENT_LOWEST_FOOD_WEIGHTS_TIME_WINDOW
    ) {
      recentLowestFoodWeights.shift();
    }

    const lowestFoodWeight = Math.min(
      ...recentLowestFoodWeights.map(item => item.weight),
    );

    console.info('宠物喂食器', {
      foodLevel: feeder.foodLevel,
      bowlFoodWeight: feeder.bowlFoodWeight,
      lowestFoodWeight,
    });

    if (feeder.bowlFoodWeight < lowestFoodWeight + FOOD_WEIGHT_LOW_THRESHOLD) {
      dispense();
    }
  });
}
