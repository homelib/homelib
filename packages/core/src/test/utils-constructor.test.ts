import {$constructor} from '../library/index.js';

test('$constructor', () => {
  const $construct = $constructor(
    class Yummy {
      food = 'rice';

      constructor(public bar: string) {}

      foo(): void {
        this.food = 'noodle';
      }
    },
  ).foo();

  const instance = $construct('abc');

  expect(instance.bar).toBe('abc');
  expect(instance.food).toBe('noodle');
});
