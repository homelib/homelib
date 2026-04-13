import {
  $automation,
  $constructor,
  Device,
  DeviceEndpoint,
} from '../../library/index.js';

import {Switch} from './switch.js';

// const $lightSwitch = $automation('light switch').devices({
//   lights
// });

export class Light extends Device<LightEndpoint> {
  readonly type = 'light';

  // switches<TSwitches extends Switch[]>(
  //   switches: TSwitches,
  // ): [this, ...TSwitches] {
  //   this.automations([]);

  //   return [this, ...switches];
  // }
}

export class LightEndpoint extends DeviceEndpoint {
  set colorTemperature(value: number) {
    // Set color temperature logic here
  }

  override dispose(): void {
    throw new Error('Method not implemented.');
  }
}

export const $light = $constructor(Light);

export const $lightSwitchAutomation = $automation.build(automation =>
  automation
    .devices({
      lights: {
        class: Light,
        multiple: true,
      },
      switches: {
        class: Switch,
        multiple: true,
      },
    })
    .automate(({devices: {lights, switches}}) => () => {}),
);
