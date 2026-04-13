import {autorun} from 'mobx';

import {$automation} from '../../../library/index.js';
import {AmbientLightSensor, Light} from '../../@devices/index.js';

export const $ambientLightAutomation = $automation.build(automation =>
  automation
    .devices({
      lights: {
        class: Light,
        multiple: true,
      },
      ambientLightSensor: AmbientLightSensor,
    })
    .configs({
      timezone: {
        type: 'text',
      },
    })
    // .initialize(
    //   ({devices: {lights, ambientLightSensor}, configs: {timezone}}) => {
    //     // Initialization logic here
    //   },
    // )
    .automate(({devices: {lights, ambientLightSensor}, configs: {timezone}}) =>
      autorun(() => {
        const colorTemperature = ambientLightSensor.colorTemperature$;

        for (const light of lights) {
          light.colorTemperature = colorTemperature;
        }
      }),
    ),
);
