import {isAutomationRequested} from './@bootstrap-arguments.js';

test('recognizes the automation flag in the script arguments', () => {
  expect(
    isAutomationRequested(['/usr/bin/node', '/automation.js', '--automation']),
  ).toBe(true);
  expect(
    isAutomationRequested([
      '/usr/bin/node',
      '/automation.js',
      '--verbose',
      '--automation',
    ]),
  ).toBe(true);
});

test('requires the exact automation flag', () => {
  expect(isAutomationRequested(['/usr/bin/node', '/automation.js'])).toBe(
    false,
  );
  expect(
    isAutomationRequested([
      '/usr/bin/node',
      '/automation.js',
      '--automation=true',
    ]),
  ).toBe(false);
});

test('does not inspect the executable or script path', () => {
  expect(isAutomationRequested(['--automation', '/automation.js'])).toBe(false);
  expect(isAutomationRequested(['/usr/bin/node', '--automation'])).toBe(false);
});

test('stops parsing options at the argument terminator', () => {
  expect(
    isAutomationRequested([
      '/usr/bin/node',
      '/automation.js',
      '--',
      '--automation',
    ]),
  ).toBe(false);
  expect(
    isAutomationRequested([
      '/usr/bin/node',
      '/automation.js',
      '--automation',
      '--',
    ]),
  ).toBe(true);
});
