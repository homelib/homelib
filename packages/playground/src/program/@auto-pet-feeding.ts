import {type PetFeeder, autorun, observable, reaction} from '@homelib/core';
import {createHeartbeat, debounce, now} from '@homelib/utils';
import ms from 'ms';

const RECENT_LOWEST_FOOD_WEIGHTS_TIME_WINDOW = ms('12h');
const AUTORUN_HEARTBEAT_INTERVAL = ms('3h');

const FOOD_WEIGHT_LOW_THRESHOLD = 3;

const QUOTA_RESET_HOURS = [0, 6, 12, 18];
const QUOTA_PORTIONS = 10;

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

  const quotaResetHourObservable = observable.box(0);

  let remainingQuota = QUOTA_PORTIONS;

  reaction(
    () => {
      const hour = new Date(now()).getHours();

      const resetHour = Math.max(
        ...QUOTA_RESET_HOURS.map(hourReset =>
          hour >= hourReset ? hourReset : -1,
        ),
      );

      return resetHour >= 0 ? resetHour : Math.max(...QUOTA_RESET_HOURS);
    },
    resetHour => {
      remainingQuota = QUOTA_PORTIONS;
      quotaResetHourObservable.set(resetHour);
    },
    {fireImmediately: true},
  );

  const dispense = debounce(() => {
    if (remainingQuota > 0) {
      remainingQuota--;
      feeder.dispense(1);
    }
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

    quotaResetHourObservable.get();

    console.info('宠物喂食器', {
      foodLevel: feeder.foodLevel,
      bowlFoodWeight: feeder.bowlFoodWeight,
      lowestFoodWeight,
      remainingQuota,
    });

    if (
      feeder.bowlFoodWeight < lowestFoodWeight + FOOD_WEIGHT_LOW_THRESHOLD &&
      remainingQuota > 0
    ) {
      dispense();
    }
  });
}
