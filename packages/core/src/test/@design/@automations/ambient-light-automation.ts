import {$automation} from '../../../library/index.js';
import {AmbientLightSensor, Light} from '../../@device-cases/index.js';

export const $ambientLightAutomation = $automation('环境光自动化')
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
  .react(({devices: {lights, ambientLightSensor}, configs: {timezone}}) => {
    const colorTemperature = ambientLightSensor.colorTemperature$;

    for (const light of lights) {
      light.colorTemperature = colorTemperature;
    }
  });
