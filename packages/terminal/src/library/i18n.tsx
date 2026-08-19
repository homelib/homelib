import {createContext, useContext} from 'react';

const DEFAULT_LOCALE = 'en';
const I18nLocaleContext = createContext<string>(DEFAULT_LOCALE);

export type I18nCatalog<TMessages> = {
  readonly defaultLocale: string;
  readonly translations: Readonly<Record<string, TMessages>>;
};

export type I18n<TMessages> = {
  readonly locale: string;
  readonly messages: TMessages;
};

export type I18nProviderProps = {
  readonly locale: string;
  readonly children?: React.ReactNode;
};

export function I18nProvider({
  locale,
  children,
}: I18nProviderProps): React.JSX.Element {
  return (
    <I18nLocaleContext.Provider value={locale}>
      {children}
    </I18nLocaleContext.Provider>
  );
}

export function useI18n<TMessages>(
  catalog: I18nCatalog<TMessages>,
): I18n<TMessages> {
  const requestedLocale = useContext(I18nLocaleContext);
  const locale = resolveI18nLocale(
    requestedLocale,
    Object.keys(catalog.translations),
    catalog.defaultLocale,
  );
  const messages = catalog.translations[locale];

  if (messages === undefined) {
    throw new TypeError(`Missing i18n messages for locale: ${locale}.`);
  }

  return {locale, messages};
}

export function resolveI18nLocale(
  requestedLocale: string,
  supportedLocales: readonly string[],
  defaultLocale: string,
): string {
  if (!supportedLocales.includes(defaultLocale)) {
    throw new TypeError(
      `The default locale is not supported: ${defaultLocale}.`,
    );
  }

  const requested = parseLocale(requestedLocale);

  if (requested === undefined) {
    return defaultLocale;
  }

  const supported = supportedLocales.flatMap(locale => {
    const parsed = parseLocale(locale);
    return parsed === undefined ? [] : [{locale, parsed}];
  });
  const exact = supported.find(
    candidate => candidate.parsed.toString() === requested.toString(),
  );

  if (exact !== undefined) {
    return exact.locale;
  }

  const requestedMaximized = requested.maximize();
  const sameLanguageAndScript = supported.find(candidate => {
    const maximized = candidate.parsed.maximize();

    return (
      maximized.language === requestedMaximized.language &&
      maximized.script === requestedMaximized.script
    );
  });

  if (sameLanguageAndScript !== undefined) {
    return sameLanguageAndScript.locale;
  }

  return (
    supported.find(
      candidate => candidate.parsed.language === requested.language,
    )?.locale ?? defaultLocale
  );
}

function parseLocale(locale: string): Intl.Locale | undefined {
  try {
    return new Intl.Locale(locale);
  } catch {
    return undefined;
  }
}
