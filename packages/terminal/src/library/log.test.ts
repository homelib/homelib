import {stripVTControlCharacters, styleText} from 'node:util';

import {formatLogText} from './@log-format.js';
import {writeLogEvent} from './log.js';

test('keeps endpoint log text stable when colors are rendered', () => {
  const messages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => messages.push(message);
    writeLogEvent({
      type: 'endpoint-command',
      target: {
        scopePath: ['home', 'room'],
        deviceName: 'light',
        endpointName: 'main',
      },
      connectionDescription: undefined,
      commandDescription: 'set brightness=0.4',
    });
    writeLogEvent({
      type: 'endpoint-state',
      target: {
        scopePath: ['home', 'room'],
        deviceName: 'light',
        endpointName: 'main',
      },
      connectionDescription: undefined,
      state: {ready: true, on: false, brightness: 0.4},
      previousState: undefined,
    });

    expect(messages.map(stripVTControlCharacters)).toEqual([
      '[homelib] home › room · device light · endpoint main command set brightness=0.4',
      '[homelib] home › room · device light · endpoint main state ready=true on=false brightness=0.4',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('renders only changed ready-state values', () => {
  const messages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => messages.push(message);
    writeLogEvent({
      type: 'endpoint-state',
      target: {
        scopePath: ['home'],
        deviceName: 'light',
        endpointName: '',
      },
      connectionDescription: 'protocol light',
      state: {ready: true, on: true, brightness: 0.5},
      previousState: {ready: true, on: false, brightness: 0.5},
    });

    expect(messages.map(stripVTControlCharacters)).toEqual([
      '[homelib] home · device light · protocol light state on=true',
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
