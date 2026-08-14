import {Device} from './device.js';
import {register} from './registry.js';
import {Scope} from './scope.js';

test('rejects duplicate child scope declarations', () => {
  const home = new Scope('home');

  home.$scope('room');

  expect(() => home.$scope('room')).toThrow('Duplicate scope: room.');
});

test('creates and declares a device from a provider namespace', () => {
  register('test', {
    device: TestDevice,
  });

  const room = new Scope('home').$scope('room');
  const device = room.test.$device('test device');
  const [deviceEntry] = [...room.devices];

  expect(() => room.test.$device('test device')).toThrow(
    'Duplicate device: test device.',
  );
  expect(device.name).toBe('test device');
  expect(deviceEntry.name).toBe('test device');
  expect([...deviceEntry.instances]).toEqual([device]);
  expect([...deviceEntry.constructors]).toEqual([TestDevice]);
  expect(() => deviceEntry.createInstance(TestDevice)).toThrow(
    'Duplicate device instance: test device.',
  );
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
