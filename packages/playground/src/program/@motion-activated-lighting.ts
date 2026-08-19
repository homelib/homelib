import {
  type AmbientLightLevelSource,
  type Light,
  type MotionDetectionSource,
} from '@homelib/core';
import {observable} from '@homelib/core/mobx';
import {now, whenever} from '@homelib/utils';
import ms from 'ms';

const LIGHT_ON_DURATION = ms('1m');

export function setupMotionActivatedLighting(
  sensor: MotionDetectionSource & AmbientLightLevelSource,
  light: Light,
): void {
  const lightOffAtObservable = observable.box<Date | undefined>();

  whenever(
    () =>
      sensor.ready &&
      sensor.motionDetected === true &&
      sensor.ambientLightLevel === 'low' &&
      light.ready,
    () => {
      light.setBrightness(0).setColorTemperature(0).turnOn();

      lightOffAtObservable.set(new Date(Date.now() + LIGHT_ON_DURATION));
    },
  );

  whenever(
    () => {
      if (!sensor.ready || !light.ready) {
        return false;
      }

      const lightOffAt = lightOffAtObservable.get();

      return lightOffAt !== undefined && lightOffAt.getTime() <= now();
    },
    () => {
      light.turnOff();
    },
  );

  whenever(
    () => {
      if (!sensor.ready || !light.ready) {
        return false;
      }

      return !light.on;
    },
    () => {
      lightOffAtObservable.set(undefined);
    },
  );
}
