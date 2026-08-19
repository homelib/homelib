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

export function getRequestedLocale(
  argv: readonly string[],
  environmentLocale: string | undefined,
  systemLocale: string,
): string {
  return getLocaleArgument(argv) ?? environmentLocale ?? systemLocale;
}

function getLocaleArgument(argv: readonly string[]): string | undefined {
  const arguments_ = argv.slice(2);

  for (const [index, argument] of arguments_.entries()) {
    if (argument === '--') {
      return undefined;
    }

    if (argument.startsWith('--locale=')) {
      const locale = argument.slice('--locale='.length);
      return locale === '' ? undefined : locale;
    }

    if (argument === '--locale') {
      const locale = arguments_.at(index + 1);
      return locale === undefined || locale.startsWith('--')
        ? undefined
        : locale;
    }
  }

  return undefined;
}
