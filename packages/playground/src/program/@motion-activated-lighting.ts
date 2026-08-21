import {
  type AmbientLightLevelSource,
  type Light,
  type MotionDetectionSource,
} from '@homelib/core';
import {now, whenever} from '@homelib/utils';
import ms from 'ms';

const LIGHT_ON_DURATION = ms('1m');

export function setupMotionActivatedLighting(
  sensor: MotionDetectionSource & AmbientLightLevelSource,
  light: Light,
): void {
  const ready = whenever(() => sensor.ready && light.ready);

  let turnOffAt: number | undefined = undefined;

  ready.then(() =>
    sensor.onMotionDetected(() => {
      if (sensor.ambientLightLevel === 'low') {
        light.setBrightness(0).setColorTemperature(0).turnOn();
        turnOffAt = Date.now() + LIGHT_ON_DURATION;
      }
    }),
  );

  ready
    .and(() => now() > (turnOffAt ?? Infinity))
    .then(() => {
      light.turnOff();
    });

  ready
    // 手动关灯也可触发
    .and(() => !light.on)
    .then(() => {
      turnOffAt = undefined;
    });
}
