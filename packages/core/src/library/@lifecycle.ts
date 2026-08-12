let phase: RuntimePhase = 'declaring';

export function assertDeclaring(): void {
  if (phase !== 'declaring') {
    throw new Error('Logical declarations are closed.');
  }
}

export function beginBootstrap(): void {
  assertDeclaring();
  phase = 'starting';
}

export function completeBootstrap(): void {
  if (phase !== 'starting') {
    throw new Error(`Cannot complete homelib bootstrap from phase: ${phase}.`);
  }

  phase = 'running';
}

export function failBootstrap(): void {
  if (phase !== 'starting') {
    throw new Error(`Cannot fail homelib bootstrap from phase: ${phase}.`);
  }

  phase = 'failed';
}

type RuntimePhase = 'declaring' | 'starting' | 'running' | 'failed';
