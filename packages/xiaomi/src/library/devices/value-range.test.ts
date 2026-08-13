import type {MiotSpecValueRange} from '../miot/index.js';

import {clampAndQuantizeValue} from './value-range.js';

test('clamps and quantizes values without exceeding floating-point bounds', () => {
  const valueRange: MiotSpecValueRange = [0.1, 0.3, 0.1];

  expect(clampAndQuantizeValue(0, valueRange)).toBe(0.1);
  expect(clampAndQuantizeValue(0.19, valueRange)).toBeCloseTo(0.2);
  expect(clampAndQuantizeValue(0.31, valueRange)).toBe(0.3);
});
