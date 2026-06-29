import {$constructor} from './constructor.js';

test('$constructor', () => {
  const $yummy = $constructor(
    class Yummy<TFood extends string> {
      ready = false;

      constructor(
        public food: TFood,
        public bar: string,
      ) {}

      up(): this {
        this.ready = true;
        return this;
      }

      foo<TFoodRefined extends TFood>(food: TFoodRefined): Yummy<TFoodRefined>;
      foo(food: TFood): this {
        this.food = food;
        return this;
      }
    },
  ).build(yummy => yummy.foo('noodle'));

  const $yummy2 = $yummy.build(yummy => yummy.up());

  const yummy = $yummy('rice', 'abc');

  expect(yummy.ready).toBe(false);
  expect(yummy.bar).toBe('abc');
  expect(yummy.food).toBe('noodle');

  const yummy2 = $yummy2('rice', 'abc');

  expect(yummy2.ready).toBe(true);
  expect(yummy2.bar).toBe('abc');
  expect(yummy2.food).toBe('noodle');
});
