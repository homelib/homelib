import {getRequestedLocale, isRunRequested} from '../@bootstrap-arguments.js';

test('recognizes the run flag in the script arguments', () => {
  expect(isRunRequested(['/usr/bin/node', '/automation.js', '--run'])).toBe(
    true,
  );
  expect(
    isRunRequested(['/usr/bin/node', '/automation.js', '--verbose', '--run']),
  ).toBe(true);
});

test('requires the exact run flag', () => {
  expect(isRunRequested(['/usr/bin/node', '/automation.js'])).toBe(false);
  expect(
    isRunRequested(['/usr/bin/node', '/automation.js', '--run=true']),
  ).toBe(false);
  expect(
    isRunRequested(['/usr/bin/node', '/automation.js', '--automation']),
  ).toBe(false);
});

test('does not inspect the executable or script path', () => {
  expect(isRunRequested(['--run', '/automation.js'])).toBe(false);
  expect(isRunRequested(['/usr/bin/node', '--run'])).toBe(false);
});

test('stops parsing options at the argument terminator', () => {
  expect(
    isRunRequested(['/usr/bin/node', '/automation.js', '--', '--run']),
  ).toBe(false);
  expect(
    isRunRequested(['/usr/bin/node', '/automation.js', '--run', '--']),
  ).toBe(true);
});

test('resolves the requested locale by precedence', () => {
  expect(
    getRequestedLocale(
      ['/usr/bin/node', '/automation.js', '--locale=zh-CN'],
      'en-GB',
      'en-US',
    ),
  ).toBe('zh-CN');
  expect(
    getRequestedLocale(
      ['/usr/bin/node', '/automation.js', '--locale', 'zh-TW'],
      'en-GB',
      'en-US',
    ),
  ).toBe('zh-TW');
  expect(
    getRequestedLocale(['/usr/bin/node', '/automation.js'], 'zh-Hans', 'en-US'),
  ).toBe('zh-Hans');
  expect(
    getRequestedLocale(['/usr/bin/node', '/automation.js'], undefined, 'en-US'),
  ).toBe('en-US');
});

test('does not read locale options after the argument terminator', () => {
  expect(
    getRequestedLocale(
      ['/usr/bin/node', '/automation.js', '--', '--locale=zh-CN'],
      undefined,
      'en-US',
    ),
  ).toBe('en-US');
});
