import {$home} from '../home.js';

test('rejects duplicate home declarations', () => {
  $home('home');

  expect(() => $home('home')).toThrow('Duplicate home: home.');
});
