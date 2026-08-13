import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {action, observable} from 'mobx';
import * as x from 'x-value';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointReference,
  createEndpointConnectionBinding,
} from '../endpoint.js';
import {type EndpointConnectionBindingPlan, Provider} from '../provider.js';
import {register, registerRootScope} from '../registry.js';
import {Scope} from '../scope.js';

import {readBindingFile} from './binding.js';
import {
  type BootstrapContext,
  registerBootstrapFrontend,
} from './bootstrap-frontend.js';
import {bootstrap} from './bootstrap.js';

const TestEndpointConnectionMetadata = x.object({
  value: x.string,
});

type TestEndpointConnectionMetadata = x.TypeOf<
  typeof TestEndpointConnectionMetadata
>;

test('validates metadata before creating an endpoint connection', async () => {
  const provider = new TestProvider('provider');
  const endpoint = new TestEndpoint();

  expect(() =>
    provider.createEndpointConnectionBindingPlan(endpoint, {value: 1}),
  ).toThrow('Value does not satisfy the type');
  expect(provider.endpointConnections).toHaveLength(0);

  const plan = provider.createEndpointConnectionBindingPlan(endpoint, {
    value: 'metadata',
  });

  expect(provider.endpointConnections).toHaveLength(0);

  await plan.create();

  expect(provider.endpointConnections).toHaveLength(1);
});

test('binds configured endpoints before resolving', async () => {
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-bootstrap-test-'),
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
    room.createDeviceEntry('unbound-device').createInstance(TestDevice);

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
            metadata: {value: 'initial metadata'},
          },
          {
            endpoint: {
              scopePath: ['home', 'room'],
              deviceName: 'removed-device',
              endpointName: '',
            },
            provider: {namespace: 'removed', name: 'provider'},
            metadata: {value: 'stale metadata'},
          },
          {
            endpoint: {
              scopePath: ['home', 'room'],
              deviceName: 'removed-device',
              endpointName: '',
            },
            provider: {namespace: 'removed', name: 'duplicate'},
            metadata: {value: 'duplicate stale metadata'},
          },
        ],
      }),
    );

    let bootstrapContext: BootstrapContext | undefined;

    registerBootstrapFrontend(async context => {
      bootstrapContext = context;
      expect(context.providers).toEqual([{namespace: 'test', provider}]);
      expect(context.bindingScopes[0]?.path).toEqual(['home']);
      expect(context.initialBindingFile.bindings).toHaveLength(3);

      await context.updateBindingFile(bindingFile => ({
        ...bindingFile,
        bindings: bindingFile.bindings.map(binding => ({
          ...binding,
          metadata: {value: 'updated metadata'},
        })),
      }));
    });

    await bootstrap();
    await Promise.resolve();

    const persistedBindingFile = await readBindingFile();

    expect(persistedBindingFile.bindings).toHaveLength(3);
    expect(
      persistedBindingFile.bindings.filter(
        binding => binding.endpoint.deviceName === 'removed-device',
      ),
    ).toHaveLength(2);
    expect(provider.processedValues).toEqual([]);

    device.send(2);
    provider.setConnectionsReady();
    await Promise.resolve();

    expect(provider.processedValues).toEqual([1, 2]);
    expect(provider.receivedMetadata).toEqual({value: 'updated metadata'});

    if (bootstrapContext === undefined) {
      throw new Error('Bootstrap frontend was not presented.');
    }

    await expect(
      bootstrapContext.updateBindingFile(bindingFile => bindingFile),
    ).rejects.toThrow('Bootstrap context is closed.');
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

class TestProvider extends Provider<TestEndpointConnectionMetadata> {
  override readonly EndpointConnectionMetadata = TestEndpointConnectionMetadata;

  readonly processedValues: number[] = [];

  receivedMetadata: TestEndpointConnectionMetadata | undefined;

  private readonly connectionValues: TestEndpointConnection[] = [];

  override get endpointConnections(): readonly TestEndpointConnection[] {
    return this.connectionValues;
  }

  setConnectionsReady(): void {
    for (const connection of this.connectionValues) {
      connection.setReady();
    }
  }

  protected override createEndpointConnectionBindingPlanFromMetadata(
    endpoint: EndpointReference,
    metadata: TestEndpointConnectionMetadata,
  ): EndpointConnectionBindingPlan {
    if (!(endpoint instanceof TestEndpoint)) {
      throw new TypeError('Unexpected test endpoint.');
    }

    this.receivedMetadata = metadata;

    return {
      resourceKeys: [],
      create: () => {
        const connection = new TestEndpointConnection(this);
        this.connectionValues.push(connection);

        return Promise.resolve(
          createEndpointConnectionBinding(endpoint, connection),
        );
      },
    };
  }
}

class TestEndpointConnection implements EndpointConnection<TestCommand> {
  @observable accessor ready = false;

  constructor(readonly provider: TestProvider) {}

  @action
  setReady(): void {
    this.ready = true;
  }

  async processCommand(command: TestCommand): Promise<void> {
    this.provider.processedValues.push(command.value);
  }
}
