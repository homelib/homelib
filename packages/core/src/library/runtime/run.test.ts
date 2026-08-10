import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import * as x from 'x-value';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, EndpointConnection} from '../endpoint.js';
import {Provider} from '../provider.js';
import {register, registerRootScope} from '../registry.js';
import {Scope} from '../scope.js';

import {run} from './run.js';

const TestEndpointConnectionMetadata = x.object({
  value: x.string,
});

type TestEndpointConnectionMetadata = x.TypeOf<
  typeof TestEndpointConnectionMetadata
>;

test('binds every declared endpoint before resolving', async () => {
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-run-test-'),
  );
  const originalEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;

  process.env.HOMELIB_DIRECTORY = environmentDirectory;

  try {
    const provider = new TestProvider('provider');
    register('test', provider);

    const home = new Scope('home');
    registerRootScope(home);

    const room = home.$scope('room');
    const device = room.createDeviceEntry('device').createInstance(TestDevice);

    device.send(1);

    await mkdir(environmentDirectory, {recursive: true});
    await writeFile(
      join(environmentDirectory, 'bindings.json'),
      JSON.stringify({
        version: 0,
        bindings: [
          {
            endpoint: {
              scopePath: ['home', 'room'],
              deviceName: 'device',
              endpointName: '',
            },
            provider: {namespace: 'test', name: 'provider'},
            metadata: {value: 'metadata'},
          },
        ],
      }),
    );

    await run();
    await Promise.resolve();

    expect(provider.processedValues).toEqual([1]);
    expect(provider.receivedMetadata).toEqual({value: 'metadata'});
    expect(() => home.$scope('late')).toThrow(
      'Logical declarations are closed.',
    );
  } finally {
    if (originalEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = originalEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});

class TestDevice extends Device {
  private readonly endpoint: TestEndpoint;

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(TestEndpoint);
  }

  send(value: number): void {
    this.endpoint.send(value);
  }
}

class TestEndpoint extends Endpoint<TestCommand> {
  send(value: number): void {
    this.enqueueCommand(new TestCommand(value));
  }
}

class TestCommand extends Command {
  constructor(readonly value: number) {
    super();
  }
}

class TestProvider extends Provider<
  TestCommand,
  TestEndpointConnectionMetadata
> {
  override readonly EndpointConnectionMetadata =
    TestEndpointConnectionMetadata;

  readonly processedValues: number[] = [];

  receivedMetadata: TestEndpointConnectionMetadata | undefined;

  private readonly connectionValues: TestEndpointConnection[] = [];

  override get endpointConnections(): readonly TestEndpointConnection[] {
    return this.connectionValues;
  }

  override createEndpointConnection(
    endpoint: Endpoint<TestCommand>,
    metadata: TestEndpointConnectionMetadata,
  ): PromiseLike<TestEndpointConnection> {
    if (!(endpoint instanceof TestEndpoint)) {
      throw new TypeError('Unexpected test endpoint.');
    }

    this.receivedMetadata = metadata;

    const connection = new TestEndpointConnection(this, {});
    this.connectionValues.push(connection);

    return Promise.resolve(connection);
  }
}

class TestEndpointConnection extends EndpointConnection<
  TestCommand,
  TestProvider
> {
  override get id(): string {
    return 'test';
  }

  override get online(): boolean {
    return true;
  }

  override async processCommand(command: TestCommand): Promise<void> {
    this.provider.processedValues.push(command.value);
  }
}
