import {resolveI18nLocale} from './i18n.js';

test('resolves exact and similar locales before the default locale', () => {
  const supported = ['en', 'zh-CN'] as const;

  expect(resolveI18nLocale('zh-CN', supported, 'en')).toBe('zh-CN');
  expect(resolveI18nLocale('zh-SG', supported, 'en')).toBe('zh-CN');
  expect(resolveI18nLocale('zh-TW', supported, 'en')).toBe('zh-CN');
  expect(resolveI18nLocale('zh-Hant', supported, 'en')).toBe('zh-CN');
  expect(resolveI18nLocale('en-GB', supported, 'en')).toBe('en');
  expect(resolveI18nLocale('fr-FR', supported, 'en')).toBe('en');
  expect(resolveI18nLocale('not a locale', supported, 'en')).toBe('en');
});

test('requires the default locale to be available', () => {
  expect(() => resolveI18nLocale('zh-CN', ['zh-CN'], 'en')).toThrow(
    'The default locale is not supported: en.',
  );
});
