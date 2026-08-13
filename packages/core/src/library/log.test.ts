import {Command} from './command.js';
import {
  type LogEvent,
  addLogListener,
  logEndpointCommand,
  logEndpointError,
  logEndpointState,
  setEndpointLogTarget,
} from './log.js';

test('emits structured endpoint log events', () => {
  const endpoint = {};
  const events: LogEvent[] = [];
  const removeListener = addLogListener(event => events.push(event));
  const originalDateNow = Date.now;
  const timestamp = 1_765_000_000_123;

  try {
    Date.now = () => timestamp;
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'light',
      endpointName: 'main',
    });

    logEndpointCommand(endpoint, {}, new TestCommand(), 'execute');
    logEndpointState(
      endpoint,
      {},
      {ready: true, on: false, brightness: 0.4},
      undefined,
    );

    expect(events).toEqual([
      {
        type: 'endpoint-command',
        timestamp,
        action: 'execute',
        target: {
          scopePath: ['home', 'room'],
          deviceName: 'light',
          endpointName: 'main',
        },
        connectionDescription: undefined,
        commandDescription: 'set brightness=0.4',
      },
      {
        type: 'endpoint-state',
        timestamp,
        target: {
          scopePath: ['home', 'room'],
          deviceName: 'light',
          endpointName: 'main',
        },
        connectionDescription: undefined,
        state: {ready: true, on: false, brightness: 0.4},
        previousState: undefined,
      },
    ]);
  } finally {
    Date.now = originalDateNow;
    removeListener();
  }
});

test('isolates log listeners and removes them independently', () => {
  const events: LogEvent[] = [];
  const firstError = new Error('first');
  const removeThrowingListener = addLogListener(() => {
    throw new Error('listener failed');
  });
  const removeListener = addLogListener(event => events.push(event));

  logEndpointError(firstError);
  removeThrowingListener();
  removeListener();
  logEndpointError(new Error('second'));

  expect(events).toEqual([
    {type: 'error', timestamp: expect.any(Number), error: firstError},
  ]);
});

class TestCommand extends Command {
  override toLogString(): string {
    return 'set brightness=0.4';
  }
}
