import {Device} from './device.js';
import {register} from './runtime/index.js';
import {Scope} from './scope.js';

test('creates and declares a device from a provider namespace', () => {
  register('test', {
    device: TestDevice,
  });

  const room = new Scope('home').$scope('room');
  const device = room.test.$device('test device');
  const sameDevice = room.test.$device('test device');
  const [deviceEntry] = [...room.devices];

  expect(sameDevice).toBe(device);
  expect(device.name).toBe('test device');
  expect(deviceEntry.name).toBe('test device');
  expect([...deviceEntry.instances]).toEqual([device]);
});

class TestDevice extends Device {}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {
      test: TestDeviceConstructors;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface TestDeviceConstructors {
      device: TestDevice;
    }
  }
}
