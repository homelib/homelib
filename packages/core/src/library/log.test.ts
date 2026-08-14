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

test('prefers the prepared execution description over the command one', () => {
  const endpoint = {};
  const events: LogEvent[] = [];
  const removeListener = addLogListener(event => events.push(event));
  const originalDateNow = Date.now;
  const timestamp = 1_765_000_000_456;

  try {
    Date.now = () => timestamp;
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });

    const execution = {
      brightness: 0.35,
      toLogString(): string {
        return `set brightness=${this.brightness}`;
      },
    };

    logEndpointCommand(endpoint, {}, new TestCommand(), 'execute', execution);

    expect(events).toEqual([
      {
        type: 'endpoint-command',
        timestamp,
        action: 'execute',
        target: {
          scopePath: ['home'],
          deviceName: 'device',
          endpointName: '',
        },
        connectionDescription: undefined,
        commandDescription: 'set brightness=0.35',
      },
    ]);
  } finally {
    Date.now = originalDateNow;
    removeListener();
  }
});

test('falls back to the command description when execution logging fails', () => {
  const endpoint = {};
  const events: LogEvent[] = [];
  const removeListener = addLogListener(event => events.push(event));
  const throwingGetter = Object.defineProperty({}, 'toLogString', {
    get(): never {
      throw new Error('Execution description getter failed.');
    },
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });

    logEndpointCommand(endpoint, {}, new TestCommand(), 'execute', {
      toLogString: () => {
        throw new Error('Execution description failed.');
      },
    });
    logEndpointCommand(endpoint, {}, new TestCommand(), 'skip', throwingGetter);
    logEndpointCommand(endpoint, {}, new ThrowingTestCommand(), 'execute');

    expect(
      events
        .filter(event => event.type === 'endpoint-command')
        .map(event => [event.action, event.commandDescription]),
    ).toEqual([
      ['execute', 'set brightness=0.4'],
      ['skip', 'set brightness=0.4'],
      ['execute', 'ThrowingTestCommand'],
    ]);
  } finally {
    removeListener();
  }
});

test('keeps the connection class description when connection logging fails', () => {
  const endpoint = {};
  const events: LogEvent[] = [];
  const removeListener = addLogListener(event => events.push(event));
  const connection = new ThrowingLogConnection();

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });

    logEndpointCommand(endpoint, connection, new TestCommand(), 'execute');
    logEndpointState(endpoint, connection, {ready: true}, undefined);

    expect(
      events.map(event =>
        event.type === 'error' ? undefined : event.connectionDescription,
      ),
    ).toEqual(['ThrowingLogConnection', 'ThrowingLogConnection']);
  } finally {
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

class ThrowingTestCommand extends Command {
  override toLogString(): string {
    throw new Error('Command description failed.');
  }
}

class ThrowingLogConnection {
  toLogString(): string {
    throw new Error('Connection description failed.');
  }
}
