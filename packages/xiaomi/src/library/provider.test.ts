import {$xiaomi} from './provider.js';

test('rejects duplicate provider declarations', () => {
  $xiaomi('home');

  expect(() => $xiaomi('home')).toThrow('Duplicate provider: home.');
});
