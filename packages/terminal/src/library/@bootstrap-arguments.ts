export function isRunRequested(argv: readonly string[]): boolean {
  for (const argument of argv.slice(2)) {
    if (argument === '--') {
      return false;
    }

    if (argument === '--run') {
      return true;
    }
  }

  return false;
}
