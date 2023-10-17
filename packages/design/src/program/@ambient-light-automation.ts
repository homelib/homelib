import {
  $automation,
  $constructor,
  Automation,
  Device,
  types,
} from '@homelib/core';
import {Light} from '@homelib/universal';

export class ColorTemperatureSensor extends Device {
  declare $value: number;
}

export const $colorTemperatureSensor = $constructor(ColorTemperatureSensor);

export const $ambientLightAutomation = $automation.build(automation =>
  automation
    .devices({
      lights: {
        class: Light,
        multiple: true,
      },
      test: [Light, ColorTemperatureSensor],
      colorTemperatureSensor: ColorTemperatureSensor,
    })
    .configs({
      mode: {
        type: 'mode',
        values: ['day', 'night'],
      },
    })
    // event model
    .start((devices, configs) => {
      const {
        lights,
        test: [testLight, testSensor],
        colorTemperatureSensor,
      } = devices;

      configs.mode;

      return reaction(
        () => [colorTemperatureSensor.$value, configs.mode],
        (colorTemperature, mode) => {
          for (const light of lights) {
            light.set({
              colorTemperature: mode === 'day' ? colorTemperature : 2700,
            });
          }
        },
      );
    })
    // state model
    .react(({colorTemperatureSensor}, {mode}) => {
      return {
        lights_: {
          colorTemperature:
            mode === 'day' ? colorTemperatureSensor.$value : 2700,
        },
        lights: [
          {
            $filter(light: Light) {
              return light.scopes.some(scope => scope.people);
            },
            $state: {
              colorTemperature:
                mode === 'day' ? colorTemperatureSensor.$value : 2700,
            },
          },
          {
            $filter: {
              people: true,
            },
          },
        ],
      };
    }),
);
