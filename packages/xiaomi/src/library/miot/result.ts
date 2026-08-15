// Xiaomi's official HA client treats both codes as successful execution results.
export function isSuccessfulMiotExecutionResult(
  result: MiotExecutionResult,
): boolean {
  return result.code === 0 || result.code === 1;
}

/**
 * The common execution status. MIoT action outputs are intentionally not
 * exposed until a HomeLib command has a concrete consumer for them.
 */
export type MiotExecutionResult = {
  readonly code: number;
};
