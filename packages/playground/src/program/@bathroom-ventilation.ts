import {type BathHeater, type Switch, autorun, computed} from '@homelib/core';
import {now} from '@homelib/utils';
import ms from 'ms';

const VENTILATION_DELAY_MULTIPLIER = 6;
const MINIMUM_LIGHT_ON_DURATION_FOR_DELAYED_VENTILATION = ms('5m');
const MAXIMUM_VENTILATION_DELAY = ms('1h');

export function setupBathroomVentilation(
  lightSwitch: Switch,
  bathHeater: BathHeater,
): void {
  let lightOn: boolean | undefined;
  let lightTurnedOnAt: number | undefined;
  let ventilationOffDeadline: number | undefined;

  const ventilationShouldTurnOff = computed(() => {
    const currentTime = now();
    return (
      ventilationOffDeadline !== undefined &&
      currentTime >= ventilationOffDeadline
    );
  });

  autorun(() => {
    if (!lightSwitch.ready || !bathHeater.ready) {
      lightOn = undefined;
      lightTurnedOnAt = undefined;
      return;
    }

    const nextLightOn = lightSwitch.on;
    const currentTime = Date.now();
    const previousLightOn = lightOn;
    lightOn = nextLightOn;

    if (nextLightOn === true) {
      if (previousLightOn !== true) {
        lightTurnedOnAt = currentTime;
        bathHeater.setVentilating(true);

        console.info('卫生间排风', {
          lightOn: true,
          ventilating: true,
        });
      }

      if (
        ventilationOffDeadline !== undefined &&
        ventilationOffDeadline <= currentTime
      ) {
        ventilationOffDeadline = undefined;
      }

      return;
    }

    if (nextLightOn === false) {
      if (previousLightOn === true && lightTurnedOnAt !== undefined) {
        const lightOnDuration = Math.max(0, currentTime - lightTurnedOnAt);
        const ventilationDelay =
          lightOnDuration < MINIMUM_LIGHT_ON_DURATION_FOR_DELAYED_VENTILATION
            ? 0
            : Math.min(
                lightOnDuration * VENTILATION_DELAY_MULTIPLIER,
                MAXIMUM_VENTILATION_DELAY,
              );
        const nextDeadline = currentTime + ventilationDelay;

        ventilationOffDeadline = Math.max(
          ventilationOffDeadline ?? nextDeadline,
          nextDeadline,
        );

        console.info('卫生间排风', {
          lightOn: false,
          lightOnDuration: ms(lightOnDuration),
          ventilationDelay: ms(ventilationDelay),
          ventilationOffAt: new Date(ventilationOffDeadline),
        });
      }

      lightTurnedOnAt = undefined;

      if (
        ventilationOffDeadline !== undefined &&
        ventilationShouldTurnOff.get()
      ) {
        ventilationOffDeadline = undefined;
        bathHeater.setVentilating(false);

        console.info('卫生间排风', {
          ventilating: false,
        });
      }
    } else {
      lightTurnedOnAt = undefined;
    }
  });
}
