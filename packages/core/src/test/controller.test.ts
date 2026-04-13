import {setTimeout} from 'node:timers/promises';

import type {DeviceId} from '../library/index.js';
import {Controller, ControllerStore} from '../library/index.js';

import {TestDeviceProvider} from './@device-provider.js';
import {LightEndpoint} from './@devices/index.js';
import {home_1} from './@scopes/index.js';

test('debug', async () => {
  const controllerStore = new ControllerStore(
    'test.json',
    ControllerStore.Data.nominalize({
      devices: [
        {
          id: 'light-1',
          path: ['Living Room', 'Balcony'],
          name: 'Light',
        },
        {
          id: 'light-1-switch',
          path: ['Living Room', 'Balcony'],
          name: 'Switch',
        },
      ],
    }),
  );

  const controller = new Controller(controllerStore, home_1, [
    new TestDeviceProvider([
      new LightEndpoint('light-1' as DeviceId),
      () => setTimeout(100),
      new LightEndpoint('light-1-switch' as DeviceId),
    ]),
  ]);

  await controller.start();
});
