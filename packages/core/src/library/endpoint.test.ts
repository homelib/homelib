import {action, observable, reaction} from 'mobx';

import {Command} from './command.js';
import {
  Endpoint,
  type EndpointConnection,
  EndpointConnectionError,
} from './endpoint.js';
import {setEndpointLogTarget} from './log.js';

test('consumes pending commands after binding becomes ready', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();

  endpoint.send(1);
  endpoint.send(2);
  endpoint.bindConnection(connection);

  expect(connection.processedValues).toEqual([]);

  connection.setReady(true);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([2]);
});

test('keeps a command pending when the connection becomes unavailable', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();

  endpoint.bindConnection(connection);
  endpoint.send(1);
  connection.deferNextCommand = true;
  connection.setReady(true);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([]);

  await wait(150);
  connection.setReady(true);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1]);
});

test('continues pending commands after rebinding during consumption', async () => {
  const endpoint = new TestEndpoint();
  const firstConnection = new TestEndpointConnection();
  const secondConnection = new TestEndpointConnection();
  const firstCommand = createDeferred();

  firstConnection.processCommandWith = async () => {
    await firstCommand.promise;
  };
  firstConnection.setReady(true);
  endpoint.bindConnection(firstConnection);
  endpoint.send(1);
  await flushMicrotasks();

  firstConnection.setReady(false);
  endpoint.bindConnection(secondConnection);
  secondConnection.setReady(true);
  endpoint.send(2);
  firstCommand.resolve();
  await flushMicrotasks();

  expect(firstConnection.processedValues).toEqual([]);
  expect(secondConnection.processedValues).toEqual([2]);
});

test('does not repeat an in-flight command when the queue changes', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();

  connection.processCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (command.value === 1) {
      await firstCommand.promise;
    }
  };
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1, 'first');
  await flushMicrotasks();

  endpoint.send(2, 'second');
  firstCommand.resolve();
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2]);
});

test('does not immediately retry a connection error', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  let attempts = 0;

  connection.processCommandWith = async () => {
    attempts++;
    throw new EndpointConnectionError('Connection unavailable.');
  };
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1);
  await flushMicrotasks();

  expect(attempts).toBe(1);

  connection.setReady(false);
  endpoint.bindConnection(undefined);
});

test('logs every command attempt while retrying connection errors', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const logMessages: string[] = [];
  const originalInfo = console.info;
  let attempts = 0;

  try {
    console.info = message => logMessages.push(message);
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'device',
      endpointName: 'main',
    });
    connection.processCommandWith = async command => {
      attempts++;

      if (attempts === 1) {
        throw new EndpointConnectionError('Connection unavailable.');
      }

      connection.processedValues.push(command.value);
    };
    connection.setReady(true);
    endpoint.bindConnection(connection);
    endpoint.send(1);

    await wait(150);
    await flushMicrotasks();

    expect(attempts).toBe(2);
    expect(connection.processedValues).toEqual([1]);
    expect(
      logMessages.filter(message => message.includes(' command ')),
    ).toEqual([
      '[homelib] home › room · device device · endpoint main command TestCommand',
      '[homelib] home › room · device device · endpoint main command TestCommand',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('does not let logging failures prevent command processing', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const originalInfo = console.info;

  try {
    console.info = () => {
      throw new Error('Log sink failed.');
    };
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });
    connection.setReady(true);
    endpoint.bindConnection(connection);
    endpoint.send(1);
    await flushMicrotasks();

    expect(connection.processedValues).toEqual([1]);
  } finally {
    console.info = originalInfo;
  }
});

test('logs an initially unready endpoint state', () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const logMessages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => logMessages.push(message);
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });
    endpoint.bindConnection(connection);

    expect(logMessages).toEqual([
      '[homelib] home · device device state ready=false',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('does not let error logging failures stall command processing', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const originalError = console.error;

  try {
    console.error = () => {
      throw new Error('Log sink failed.');
    };
    connection.processCommandWith = async command => {
      if (command.value === 1) {
        throw new Error('Command failed.');
      }

      connection.processedValues.push(command.value);
    };
    connection.setReady(true);
    endpoint.bindConnection(connection);
    endpoint.send(1);
    await flushMicrotasks();

    endpoint.send(2);
    await flushMicrotasks();

    expect(connection.processedValues).toEqual([2]);
  } finally {
    console.error = originalError;
  }
});

test('replaces a connection without exposing an unbound state', () => {
  const endpoint = new TestEndpoint();
  const firstConnection = new TestEndpointConnection();
  const secondConnection = new TestEndpointConnection();
  const observedConnections: (TestEndpointConnection | undefined)[] = [];
  const dispose = reaction(
    () => endpoint.boundConnection,
    connection => observedConnections.push(connection),
  );

  endpoint.bindConnection(firstConnection);
  endpoint.bindConnection(secondConnection);

  expect(observedConnections).toEqual([firstConnection, secondConnection]);

  dispose();
});

class TestCommand extends Command {
  constructor(
    readonly value: number,
    readonly target: string,
  ) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof TestCommand && command.target === this.target;
  }
}

class TestEndpoint extends Endpoint<TestCommand, TestEndpointConnection> {
  get boundConnection(): TestEndpointConnection | undefined {
    return this.connection;
  }

  send(value: number, target = 'default'): void {
    this.enqueueCommand(new TestCommand(value, target));
  }
}

class TestEndpointConnection implements EndpointConnection<TestCommand> {
  @observable accessor ready = false;

  deferNextCommand = false;

  processCommandWith: ((command: TestCommand) => Promise<void>) | undefined;

  readonly processedValues: number[] = [];

  async processCommand(command: TestCommand): Promise<void> {
    if (this.processCommandWith !== undefined) {
      await this.processCommandWith(command);
      return;
    }

    if (this.deferNextCommand) {
      this.deferNextCommand = false;
      this.setReady(false);
      throw new EndpointConnectionError('Connection unavailable.');
    }

    this.processedValues.push(command.value);
  }

  @action
  setReady(ready: boolean): void {
    this.ready = ready;
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

function createDeferred(): {promise: Promise<void>; resolve(): void} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>(resolve => {
    resolvePromise = () => resolve();
  });

  return {promise, resolve: resolvePromise};
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay));
}
