// Xiaomi's official HA client treats both codes as successful execution results.
export function isSuccessfulMiotExecutionResult(
  result: MiotExecutionResult,
): boolean {
  return result.code === 0 || result.code === 1;
}

export type MiotExecutionResult = {
  readonly code: number;
};
