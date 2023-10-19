import {$area, $home, $room, $scope} from '../../library/index.js';
import {$light} from '../@device-cases/index.js';

export const home1 = $home('Home 1').scopes([
  $room('Living Room').scopes([$area('Balcony').devices([$light('Light')])]),
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

export type home1 = typeof home1;
