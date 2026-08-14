import {isRunRequested} from './@bootstrap-arguments.js';

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
