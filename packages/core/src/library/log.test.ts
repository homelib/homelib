import {stripVTControlCharacters, styleText} from 'node:util';

import {formatLogText} from './@log-format.js';
import {Command} from './command.js';
import {
  logEndpointCommand,
  logEndpointState,
  setEndpointLogTarget,
} from './log.js';

test('keeps endpoint log text stable when colors are rendered', () => {
  const endpoint = {};
  const messages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => messages.push(message);
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'light',
      endpointName: 'main',
    });

    logEndpointCommand(endpoint, {}, new TestCommand());
    logEndpointState(
      endpoint,
      {},
      {ready: true, on: false, brightness: 0.4},
      undefined,
    );

    expect(messages.map(stripVTControlCharacters)).toEqual([
      '[homelib] home › room · device light · endpoint main command set brightness=0.4',
      '[homelib] home › room · device light · endpoint main state ready=true on=false brightness=0.4',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('renders deterministic colored and uncolored log tokens', () => {
  expect(formatLogText(['bold', 'yellow'], 'command', 'always')).toBe(
    styleText(['bold', 'yellow'], 'command', {validateStream: false}),
  );
  expect(formatLogText('cyan', 'state', 'always')).toBe(
    styleText('cyan', 'state', {validateStream: false}),
  );
  expect(formatLogText('cyan', 'state', 'never')).toBe('state');
});

class TestCommand extends Command {
  override toLogString(): string {
    return 'set brightness=0.4';
  }
}
