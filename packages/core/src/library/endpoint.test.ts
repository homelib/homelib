import {action, observable, reaction} from 'mobx';

import {Command, CommandError, StatefulCommand} from './command.js';
import {
  type CommandEffect,
  type CommandExecution,
  Endpoint,
  type EndpointConnection,
  EndpointConnectionError,
  type EndpointLogState,
  type EndpointReference,
  createEndpointConnectionBinding,
} from './endpoint.js';
import {type LogEvent, addLogListener, setEndpointLogTarget} from './log.js';

test('consumes pending commands after binding becomes ready', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();

  expect(endpoint.send(1)).toBe(endpoint);
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

  firstConnection.executeCommandWith = async () => {
    await firstCommand.promise;
  };
  firstConnection.returnEffects = true;
  firstConnection.setReady(true);
  endpoint.bindConnection(firstConnection);
  endpoint.send(1);
  await flushMicrotasks();

  firstConnection.setReady(false);
  endpoint.bindConnection(secondConnection);
  secondConnection.setReady(true);
  endpoint.send(1);
  firstCommand.resolve();
  await flushMicrotasks();

  expect(firstConnection.processedValues).toEqual([]);
  expect(secondConnection.processedValues).toEqual([1]);
});

test('does not repeat an in-flight command when the queue changes', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();

  connection.executeCommandWith = async command => {
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

test('skips a stateful command with an acknowledged equivalent effect', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const logEvents: LogEvent[] = [];
  const removeLogListener = addLogListener(event => logEvents.push(event));
  connection.returnEffects = true;
  connection.setReady(true);

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });
    endpoint.bindConnection(connection);

    endpoint.send(1);
    await flushMicrotasks();
    endpoint.send(1);
    await flushMicrotasks();

    expect(connection.processedValues).toEqual([1]);
    expect(connection.comparedEffects).toHaveLength(1);
    expect(connection.comparedEffects[0]).toBeInstanceOf(TestCommandEffect);
    expect(
      logEvents
        .filter(event => event.type === 'endpoint-command')
        .map(event => event.action),
    ).toEqual(['execute', 'skip']);
  } finally {
    removeLogListener();
  }
});

test('skips a stateful command already satisfied by observed state', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setObservedValue(1);
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([]);
});

test('executes a stateful command when checking its prepared effect throws', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const matchError = new Error('Effect match failed.');
  const logEvents: LogEvent[] = [];
  const removeLogListener = addLogListener(event => logEvents.push(event));
  connection.effectForCommand = command =>
    new TestCommandEffect(command.value, () => {
      throw matchError;
    });
  connection.setReady(true);
  endpoint.bindConnection(connection);

  try {
    endpoint.send(1);
    await flushMicrotasks();

    expect(connection.processedValues).toEqual([1]);
    expect(logEvents.filter(event => event.type === 'error')).toEqual([
      {type: 'error', timestamp: expect.any(Number), error: matchError},
    ]);
  } finally {
    removeLogListener();
  }
});

test('executes a stateless command even when its prepared effect matches', async () => {
  const endpoint = new StatelessTestEndpoint();
  const connection = new StatelessTestEndpointConnection();
  endpoint.bindConnection(connection);

  endpoint.send();
  await flushMicrotasks();
  endpoint.send();
  await flushMicrotasks();

  expect(connection.executionCount).toBe(2);
  expect(connection.effectCheckCount).toBe(0);
});

test('keeps acknowledged effects for independent command targets', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1, 'first');
  await flushMicrotasks();
  endpoint.send(1, 'second');
  await flushMicrotasks();
  endpoint.send(1, 'first');
  endpoint.send(1, 'second');
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('replaces an acknowledged effect superseded by a new command', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  endpoint.send(2);
  await flushMicrotasks();
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2, 1]);
});

test('invalidates an old effect after a superseding execution may have started', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (command.value === 2) {
      throw new Error('Execution result is unknown.');
    }
  };
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setObservedValue(1);
  endpoint.send(2);
  await flushMicrotasks();
  connection.updateUnrelatedState();
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2, 1]);
});

test('keeps observed state behind a barrier after a successful command without an effect', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setObservedValue(1);
  connection.returnEffects = false;
  endpoint.send(2);
  await flushMicrotasks();
  connection.returnEffects = true;
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2, 1]);
});

test('trusts observed state again after a newer relevant observation', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (command.value === 2) {
      throw new Error('Execution result is unknown.');
    }
  };
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setObservedValue(1);
  endpoint.send(2);
  await flushMicrotasks();
  connection.setObservedValue(1);
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2]);
});

test('preserves an old effect after a definitive command rejection', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (command.value === 2) {
      throw new CommandError('Command rejected.');
    }
  };
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setObservedValue(1);
  endpoint.send(2);
  await flushMicrotasks();
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2]);
});

test('does not let stale observed state override a newer acknowledged intent', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setObservedValue(2);
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  endpoint.send(2);
  await flushMicrotasks();
  endpoint.send(2);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2]);
});

test('reconciles effects on every relevant observation revision', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  let matchCount = 0;
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);
  };
  connection.effectForCommand = command =>
    new TestCommandEffect(
      command.value,
      () => {
        matchCount++;
      },
      undefined,
      () => connection.observedValueRevision,
    );
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setObservedValue(1);
  connection.setObservedValue(1);
  endpoint.send(1);
  await flushMicrotasks();

  expect(matchCount).toBe(3);
  expect(connection.processedValues).toEqual([1]);

  connection.setObservedValue(2);
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('removes an acknowledged effect when reconciling it throws', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  let throwOnMatch = false;
  connection.effectForCommand = command =>
    new TestCommandEffect(
      command.value,
      () => {
        if (throwOnMatch) {
          throw new Error('Effect match failed.');
        }
      },
      undefined,
      () => connection.observedValueRevision,
    );
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();

  throwOnMatch = true;
  connection.setObservedValue(1);
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('does not reconcile an effect after an unrelated state update', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setObservedValue(1);
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(2);
  await flushMicrotasks();
  connection.updateUnrelatedState();
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([2, 1]);
});

test('accepts an in-flight effect confirmed by a newer relevant observation', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (connection.processedValues.length === 1) {
      await firstCommand.promise;
    }
  };
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1);
  await flushMicrotasks();

  connection.setObservedValue(1);
  endpoint.send(1);
  firstCommand.resolve();
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1]);
});

test('does not let a late acknowledgement override newer mismatching state', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (connection.processedValues.length === 1) {
      await firstCommand.promise;
    }
  };
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1);
  await flushMicrotasks();

  connection.setObservedValue(2);
  endpoint.send(1);
  firstCommand.resolve();
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('keeps a late acknowledgement uncertain through unrelated updates', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (connection.processedValues.length === 1) {
      await firstCommand.promise;
    }
  };
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1);
  await flushMicrotasks();

  connection.setObservedValue(2);
  firstCommand.resolve();
  await flushMicrotasks();
  connection.updateUnrelatedState();
  endpoint.send(2);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 2]);
});

test('clears acknowledged effects while the connection is unready', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);

  endpoint.send(1);
  await flushMicrotasks();
  connection.setReady(false);
  connection.setReady(true);
  endpoint.send(1);
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('rejects an in-flight effect from before an unready interval', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const firstCommand = createDeferred();
  connection.executeCommandWith = async command => {
    connection.processedValues.push(command.value);

    if (connection.processedValues.length === 1) {
      await firstCommand.promise;
    }
  };
  connection.returnEffects = true;
  connection.setReady(true);
  endpoint.bindConnection(connection);
  endpoint.send(1);
  await flushMicrotasks();

  connection.setReady(false);
  connection.setReady(true);
  endpoint.send(1);
  firstCommand.resolve();
  await flushMicrotasks();

  expect(connection.processedValues).toEqual([1, 1]);
});

test('clears acknowledged effects when replacing the connection', async () => {
  const endpoint = new TestEndpoint();
  const firstConnection = new TestEndpointConnection();
  const secondConnection = new TestEndpointConnection();
  firstConnection.returnEffects = true;
  secondConnection.returnEffects = true;
  firstConnection.setReady(true);
  secondConnection.setReady(true);
  endpoint.bindConnection(firstConnection);

  endpoint.send(1);
  await flushMicrotasks();
  endpoint.bindConnection(secondConnection);
  endpoint.send(1);
  await flushMicrotasks();

  expect(firstConnection.processedValues).toEqual([1]);
  expect(secondConnection.processedValues).toEqual([1]);
});

test('does not immediately retry a connection error', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  let attempts = 0;

  connection.executeCommandWith = async () => {
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
  const logEvents: LogEvent[] = [];
  const removeLogListener = addLogListener(event => logEvents.push(event));
  let attempts = 0;

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'device',
      endpointName: 'main',
    });
    connection.executeCommandWith = async command => {
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
      logEvents
        .filter(event => event.type === 'endpoint-command')
        .map(event => [event.action, event.commandDescription]),
    ).toEqual([
      ['execute', 'TestCommand'],
      ['execute', 'TestCommand'],
    ]);
  } finally {
    removeLogListener();
  }
});

test('does not log a command action when command preparation fails', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const logEvents: LogEvent[] = [];
  const removeLogListener = addLogListener(event => logEvents.push(event));
  connection.prepareCommandError = new CommandError('Invalid command.');
  connection.setReady(true);

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    endpoint.send(1);
    await flushMicrotasks();

    expect(
      logEvents.filter(event => event.type === 'endpoint-command'),
    ).toEqual([]);
    expect(logEvents.filter(event => event.type === 'error')).toHaveLength(1);
  } finally {
    removeLogListener();
  }
});

test('does not let logging failures prevent command processing', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const removeLogListener = addLogListener(() => {
    throw new Error('Log listener failed.');
  });

  try {
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
    removeLogListener();
  }
});

test('logs an initially unready endpoint state', () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const logEvents: LogEvent[] = [];
  const removeLogListener = addLogListener(event => logEvents.push(event));

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'device',
      endpointName: '',
    });
    endpoint.bindConnection(connection);

    expect(logEvents).toEqual([
      {
        type: 'endpoint-state',
        timestamp: expect.any(Number),
        target: {
          scopePath: ['home'],
          deviceName: 'device',
          endpointName: '',
        },
        connectionDescription: undefined,
        state: {ready: false},
        previousState: undefined,
      },
    ]);
  } finally {
    removeLogListener();
  }
});

test('does not let error logging failures stall command processing', async () => {
  const endpoint = new TestEndpoint();
  const connection = new TestEndpointConnection();
  const removeLogListener = addLogListener(() => {
    throw new Error('Log listener failed.');
  });

  try {
    connection.executeCommandWith = async command => {
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
    removeLogListener();
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

test('disposes an endpoint connection binding once without unbinding a replacement', async () => {
  const endpoint = new TestEndpoint();
  const firstConnection = new TestEndpointConnection();
  const secondConnection = new TestEndpointConnection();
  const disposeConnection = import.meta.jest.fn();
  const binding = createEndpointConnectionBinding(
    endpoint,
    firstConnection,
    disposeConnection,
  );

  binding.bind();
  endpoint.bindConnection(secondConnection);
  await binding.dispose();
  await binding.dispose();

  expect(endpoint.boundConnection).toBe(secondConnection);
  expect(disposeConnection).toHaveBeenCalledTimes(1);
  expect(() => binding.bind()).toThrow(
    'Cannot bind a disposed endpoint connection.',
  );
});

test('disposes a connection after endpoint binding partially succeeds', async () => {
  const endpoint = new PartiallyFailingTestEndpoint();
  const connection = new TestEndpointConnection();
  const disposeConnection = import.meta.jest.fn();
  const binding = createEndpointConnectionBinding(
    endpoint,
    connection,
    disposeConnection,
  );

  expect(() => binding.bind()).toThrow('Endpoint binding failed.');
  expect(endpoint.boundConnection).toBe(connection);

  await binding.dispose();

  expect(endpoint.boundConnection).toBeUndefined();
  expect(disposeConnection).toHaveBeenCalledTimes(1);
});

test('disposes a connection and aggregates errors when endpoint unbinding throws', async () => {
  const unbindingError = new Error('Endpoint unbinding failed.');
  const connectionDisposalError = new Error('Connection disposal failed.');
  const endpoint = new UnbindingFailingTestEndpoint(unbindingError);
  const connection = new TestEndpointConnection();
  const disposeConnection = import.meta.jest.fn(() => {
    throw connectionDisposalError;
  });
  const binding = createEndpointConnectionBinding(
    endpoint,
    connection,
    disposeConnection,
  );

  binding.bind();
  const disposal = binding.dispose();

  expect(binding.dispose()).toBe(disposal);
  await expect(disposal).rejects.toMatchObject({
    errors: [unbindingError, connectionDisposalError],
  });
  expect(endpoint.boundConnection).toBeUndefined();
  expect(disposeConnection).toHaveBeenCalledTimes(1);
});

class TestCommand extends StatefulCommand {
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
  get observedValue(): number | undefined {
    return this.connection?.observedValue;
  }

  get boundConnection(): TestEndpointConnection | undefined {
    return this.connection;
  }

  protected override get logState(): EndpointLogState {
    return {
      ready: this.ready,
      observedValue: this.observedValue,
    };
  }

  send(value: number, target = 'default'): this {
    return this.enqueueCommand(new TestCommand(value, target));
  }
}

class StatelessTestCommand extends Command {}

class StatelessTestEndpoint extends Endpoint<
  StatelessTestCommand,
  StatelessTestEndpointConnection
> {
  send(): this {
    return this.enqueueCommand(new StatelessTestCommand());
  }
}

class StatelessTestEndpointConnection implements EndpointConnection<StatelessTestCommand> {
  readonly ready = true;

  readonly stateRevision = 0;

  executionCount = 0;

  effectCheckCount = 0;

  prepareCommand(_command: StatelessTestCommand): CommandExecution {
    return {
      effect: {
        observationRevision: 0,
        equals: () => {
          this.effectCheckCount++;
          return true;
        },
        matches: () => {
          this.effectCheckCount++;
          return true;
        },
      },
      execute: async () => {
        this.executionCount++;
      },
    };
  }
}

class PartiallyFailingTestEndpoint extends TestEndpoint {
  override bindConnection(
    connection: TestEndpointConnection | undefined,
  ): void {
    super.bindConnection(connection);

    if (connection !== undefined) {
      throw new Error('Endpoint binding failed.');
    }
  }
}

class UnbindingFailingTestEndpoint extends TestEndpoint {
  constructor(private readonly unbindingError: Error) {
    super();
  }

  override unbindConnection(connection: TestEndpointConnection): void {
    super.unbindConnection(connection);
    throw this.unbindingError;
  }
}

class TestEndpointConnection implements EndpointConnection<TestCommand> {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor observedValue: number | undefined;

  observedValueRevision = 0;

  deferNextCommand = false;

  prepareCommandError: Error | undefined;

  returnEffects = false;

  executeCommandWith: ((command: TestCommand) => PromiseLike<void>) | undefined;

  effectForCommand:
    ((command: TestCommand) => CommandEffect | undefined) | undefined;

  readonly processedValues: number[] = [];

  readonly comparedEffects: CommandEffect[] = [];

  prepareCommand(command: TestCommand): CommandExecution {
    if (this.prepareCommandError !== undefined) {
      throw this.prepareCommandError;
    }

    let effect: CommandEffect | undefined;

    if (this.effectForCommand !== undefined) {
      effect = this.effectForCommand(command);
    } else if (this.returnEffects) {
      effect = new TestCommandEffect(
        command.value,
        () => undefined,
        comparedEffect => this.comparedEffects.push(comparedEffect),
        () => this.observedValueRevision,
      );
    }

    return {
      effect,
      execute: async () => {
        if (this.executeCommandWith !== undefined) {
          await this.executeCommandWith(command);
          return;
        }

        if (this.deferNextCommand) {
          this.deferNextCommand = false;
          this.setReady(false);
          throw new EndpointConnectionError('Connection unavailable.');
        }

        this.processedValues.push(command.value);
      },
    };
  }

  @action
  setReady(ready: boolean): void {
    this.ready = ready;
  }

  @action
  setObservedValue(value: number | undefined): void {
    this.observedValue = value;
    this.observedValueRevision++;
    this.stateRevision++;
  }

  @action
  updateUnrelatedState(): void {
    this.stateRevision++;
  }
}

class TestCommandEffect implements CommandEffect {
  constructor(
    private readonly value: number,
    private readonly onMatches: () => void = () => undefined,
    private readonly onEquals: (effect: CommandEffect) => void = () =>
      undefined,
    private readonly getObservationRevision: () => number = () => 0,
  ) {}

  get observationRevision(): number {
    return this.getObservationRevision();
  }

  equals(effect: CommandEffect): boolean {
    this.onEquals(effect);

    return effect instanceof TestCommandEffect && effect.value === this.value;
  }

  matches(endpoint: EndpointReference): boolean {
    this.onMatches();
    return (
      endpoint instanceof TestEndpoint && endpoint.observedValue === this.value
    );
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
