import type {MiotSpecValueRange} from '../miot/index.js';

export function clampAndQuantizeValue(
  value: number,
  [minimum, maximum, step]: MiotSpecValueRange,
): number {
  const maximumStepIndex = Math.round((maximum - minimum) / step);
  const stepIndex = Math.min(
    maximumStepIndex,
    Math.max(0, Math.round((value - minimum) / step)),
  );

  return Math.min(maximum, minimum + stepIndex * step);
}
