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
      timestamp: TEST_TIMESTAMP,
      action: 'execute',
      target: {
        scopePath: ['home', 'room'],
        deviceName: 'light',
        endpointName: 'main',
      },
      connectionDescription: undefined,
      commandDescription: 'set brightness=0.4',
    });
    writeLogEvent({
      type: 'endpoint-event',
      timestamp: TEST_TIMESTAMP,
      target: {
        scopePath: ['home', 'room'],
        deviceName: 'sensor',
        endpointName: '',
      },
      connectionDescription: 'protocol sensor',
      eventDescription: 'motionDetected',
    });
    writeLogEvent({
      type: 'endpoint-state',
      timestamp: TEST_TIMESTAMP,
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
      '[homelib] 2026-01-02 03:04:05.006 home › room · device light · endpoint main execute set brightness=0.4',
      '[homelib] 2026-01-02 03:04:05.006 home › room · device sensor · protocol sensor event motionDetected',
      '[homelib] 2026-01-02 03:04:05.006 home › room · device light · endpoint main state ready=true on=false brightness=0.4',
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
      timestamp: TEST_TIMESTAMP,
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
      '[homelib] 2026-01-02 03:04:05.006 home · device light · protocol light state on=true',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('renders skipped commands separately from execution attempts', () => {
  const messages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => messages.push(message);
    writeLogEvent({
      type: 'endpoint-command',
      timestamp: TEST_TIMESTAMP,
      action: 'skip',
      target: {
        scopePath: ['home'],
        deviceName: 'light',
        endpointName: '',
      },
      connectionDescription: 'protocol light',
      commandDescription: 'set on=true',
    });

    expect(messages.map(stripVTControlCharacters)).toEqual([
      '[homelib] 2026-01-02 03:04:05.006 home · device light · protocol light skip set on=true',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('prefixes errors with their timestamp without flattening the error', () => {
  const messages: unknown[][] = [];
  const originalError = console.error;
  const error = new Error('failed');

  try {
    console.error = (...values) => messages.push(values);
    writeLogEvent({type: 'error', timestamp: TEST_TIMESTAMP, error});

    expect(
      messages.map(([prefix, loggedError]) => [
        stripVTControlCharacters(String(prefix)),
        loggedError,
      ]),
    ).toEqual([['[homelib] 2026-01-02 03:04:05.006 error', error]]);
  } finally {
    console.error = originalError;
  }
});

test('renders deterministic colored and uncolored log tokens', () => {
  expect(formatLogText(['bold', 'yellow'], 'execute', 'always')).toBe(
    styleText(['bold', 'yellow'], 'execute', {validateStream: false}),
  );
  expect(formatLogText('cyan', 'state', 'always')).toBe(
    styleText('cyan', 'state', {validateStream: false}),
  );
  expect(formatLogText('cyan', 'state', 'never')).toBe('state');
});

const TEST_TIMESTAMP = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
