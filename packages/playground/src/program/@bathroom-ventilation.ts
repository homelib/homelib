import {type BathHeater, type Switch, computed} from '@homelib/core';
import {now, whenever} from '@homelib/utils';
import ms from 'ms';

const VENTILATION_DELAY_MULTIPLIER = 5;
const MINIMUM_LIGHT_ON_DURATION_FOR_DELAYED_VENTILATION = ms('5m');
const MAXIMUM_VENTILATION_DELAY = ms('1h');

export function setupBathroomVentilation(
  lightSwitch: Switch,
  bathHeater: BathHeater,
): void {
  const ready = whenever(() => lightSwitch.ready && bathHeater.ready);

  let turnedOnAt: number | undefined = undefined;

  let ventilateUntil = Date.now();

  ready.autorun(() => {
    const nowTime = Date.now();

    if (lightSwitch.on) {
      if (turnedOnAt === undefined) {
        turnedOnAt = nowTime;
      }
    } else {
      if (turnedOnAt !== undefined) {
        const lightOnDuration = nowTime - turnedOnAt;

        if (
          lightOnDuration > MINIMUM_LIGHT_ON_DURATION_FOR_DELAYED_VENTILATION
        ) {
          ventilateUntil = Math.min(
            Math.max(nowTime, ventilateUntil) +
              lightOnDuration * VENTILATION_DELAY_MULTIPLIER,
            nowTime + MAXIMUM_VENTILATION_DELAY,
          );

          console.info('卫生间排风', {
            ventilateUntil: new Date(ventilateUntil).toLocaleString(),
          });
        }

        turnedOnAt = undefined;
      }
    }
  });

  const ventilating = computed(() => lightSwitch.on || now() < ventilateUntil);

  ready.autorun(() => {
    bathHeater.setVentilating(ventilating.get());
  });
}
