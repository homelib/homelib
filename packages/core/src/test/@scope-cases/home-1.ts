import {$area, $home, $room, $scope} from '../../library/index.js';
import {$light} from '../@device-cases/index.js';

export const home1 = $home('Home 1').scopes({
  'living-room': $room('Living Room').scopes({
    balcony: $area('Balcony').devices({
      light: $light('Light'),
    }),
  }),
  bedroom: $room('Bedroom').scopes({
    'level-2': $scope('Level 2').scopes({
      'level-3': $scope('Level 3').scopes({
        'level-4': $scope('Level 4').scopes({
          'level-5': $scope('Level 5').scopes({
            'level-6': $scope('Level 6').scopes({
              'level-7': $scope('Level 7').devices({
                light: $light('Light'),
              }),
            }),
          }),
        }),
      }),
    }),
    duplicate: $scope('Duplicate').scopes({
      duplicate: $scope('Duplicate').devices({
        light: $light('Light'),
      }),
    }),
  }),
});

export type home1 = typeof home1;
