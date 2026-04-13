import {$, $area, $home, $room} from '../../library/index.js';
import {
  $light,
  $lightSwitchAutomation,
  $switch,
  $television,
} from '../@devices/index.js';

export const home_1 = $home('Home 1').scopes([
  $room('Living Room')
    .scopes([
      $area('Balcony')
        .devices([$light('Light'), $switch('Light Switch')])
        .automations([
          $lightSwitchAutomation('Light Switch Automation').bind({
            lights: $(),
            switches: $(),
          }),
        ]),
    ])
    .devices([$television('Television')]),
  $room('Bedroom').scopes([
    $area('Level 2').scopes([
      $area('Level 3').scopes([
        $area('Level 4').scopes([
          $area('Level 5').scopes([
            $area('Level 6').scopes([
              $area('Level 7').devices([$light('Light')]),
            ]),
          ]),
        ]),
      ]),
    ]),
    $area('Duplicate').scopes([$area('Duplicate').devices([$light('Light')])]),
  ]),
]);

export type home_1 = typeof home_1;
