import {$area, $home, $room, $scope} from '../../library/index.js';
import {$light, $television} from '../@device-cases/index.js';

export const home_1 = $home('Home 1').scopes([
  $room('Living Room')
    .scopes([$area('Balcony').devices([$light('Light')])])
    .devices([$television('Television')]),
  $room('Bedroom').scopes([
    $scope('Level 2').scopes([
      $scope('Level 3').scopes([
        $scope('Level 4').scopes([
          $scope('Level 5').scopes([
            $scope('Level 6').scopes([
              $scope('Level 7').devices([$light('Light')]),
            ]),
          ]),
        ]),
      ]),
    ]),
    $scope('Duplicate').scopes([
      $scope('Duplicate').devices([$light('Light')]),
    ]),
  ]),
]);

export type home_1 = typeof home_1;
