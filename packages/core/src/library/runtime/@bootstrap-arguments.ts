export function isAutomationRequested(argv: readonly string[]): boolean {
  for (const argument of argv.slice(2)) {
    if (argument === '--') {
      return false;
    }

    if (argument === '--automation') {
      return true;
    }
  }

  return false;
}
