let phase: RuntimePhase = 'declaring';

export function assertDeclaring(): void {
  if (phase !== 'declaring') {
    throw new Error('Logical declarations are closed.');
  }
}

export function beginRun(): void {
  assertDeclaring();
  phase = 'starting';
}

export function completeRun(): void {
  if (phase !== 'starting') {
    throw new Error(`Cannot complete homelib run from phase: ${phase}.`);
  }

  phase = 'running';
}

export function failRun(): void {
  if (phase !== 'starting') {
    throw new Error(`Cannot fail homelib run from phase: ${phase}.`);
  }

  phase = 'failed';
}

type RuntimePhase = 'declaring' | 'starting' | 'running' | 'failed';
