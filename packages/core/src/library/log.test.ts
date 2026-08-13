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

  try {
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

    expect(events).toEqual([
      {
        type: 'endpoint-command',
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
    removeListener();
  }
});

test('isolates log listeners and removes them independently', () => {
  const events: LogEvent[] = [];
  const removeThrowingListener = addLogListener(() => {
    throw new Error('listener failed');
  });
  const removeListener = addLogListener(event => events.push(event));

  logEndpointError(new Error('first'));
  removeThrowingListener();
  removeListener();
  logEndpointError(new Error('second'));

  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe('error');
});

class TestCommand extends Command {
  override toLogString(): string {
    return 'set brightness=0.4';
  }
}
