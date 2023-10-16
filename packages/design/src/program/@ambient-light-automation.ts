import {$automation, Automation, Device} from '@homelib/core';
import {Light} from '@homelib/universal';

export class ColorTemperatureSensor extends Device {
  declare $value: number;
}

export const $ambientLightAutomation = $automation.build(automation =>
  automation
    .devices({
      lights: {
        class: Light,
        multiple: true,
      },
      colorTemperatureSensor: ColorTemperatureSensor,
    })
    .configurable({
      mode: {
        type: 'enum',
        values: ['day', 'night'],
      },
    })
    // event model
    .setup(
      (
        {
          lights,
          colorTemperatureSensor,
        }: {lights: Light[]; colorTemperatureSensor: ColorTemperatureSensor},
        configs: {mode: 'day' | 'night'},
      ) => {
        reaction(
          () => [colorTemperatureSensor.$value, configs.mode],
          (colorTemperature, mode) => {
            for (const light of lights) {
              light.set({
                colorTemperature: mode === 'day' ? colorTemperature : 2700,
              });
            }
          },
        );
      },
    )
    // state model
    .reaction(
      (
        {
          colorTemperatureSensor,
        }: {lights: Light[]; colorTemperatureSensor: ColorTemperatureSensor},
        {mode}: {mode: 'day' | 'night'},
      ) => {
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
      },
    ),
);
