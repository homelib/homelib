import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {action, observable} from 'mobx';
import * as x from 'x-value';

import {Command} from '../command.js';
import {Device, type DeviceConstructor, type DeviceEntry} from '../device.js';
import {
  type CommandExecution,
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
    provider.createEndpointConnectionBindingPlan(endpoint, [TestDevice], {
      value: 1,
    }),
  ).toThrow('Value does not satisfy the type');
  expect(provider.endpointConnections).toHaveLength(0);

  const plan = provider.createEndpointConnectionBindingPlan(
    endpoint,
    [TestDevice],
    {value: 'metadata'},
  );

  expect(provider.endpointConnections).toHaveLength(0);

  const preparedPlan = await plan.prepare();

  expect(preparedPlan.persistedMetadata).toEqual({
    value: 'metadata canonical',
  });
  expect(provider.endpointConnections).toHaveLength(0);

  await preparedPlan.create();

  expect(provider.endpointConnections).toHaveLength(1);
  expect(provider.receivedDeviceConstructors).toEqual([TestDevice]);

  provider.returnInvalidPersistedMetadata = true;

  await expect(
    provider
      .createEndpointConnectionBindingPlan(endpoint, [TestDevice], {
        value: 'invalid canonical metadata',
      })
      .prepare(),
  ).rejects.toThrow('Value does not satisfy the type');
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
      expect(
        context.bindingScopes[0]?.scopes[0]?.devices.map(bindingDevice => ({
          name: bindingDevice.name,
          deviceConstructors: bindingDevice.deviceConstructors,
        })),
      ).toEqual([
        {name: 'device', deviceConstructors: [TestDevice]},
        {name: 'unbound-device', deviceConstructors: [TestDevice]},
      ]);
      expect(context.initialBindingFile.bindings).toHaveLength(3);

      let continueFirstUpdate!: () => void;
      let secondUpdateStarted = false;
      const firstUpdate = context.updateBindingFile(async bindingFile => {
        await new Promise<void>(resolve => {
          continueFirstUpdate = resolve;
        });

        return {
          ...bindingFile,
          bindings: bindingFile.bindings.map(binding => ({
            ...binding,
            metadata: {value: 'intermediate metadata'},
          })),
        };
      });
      const secondUpdate = context.updateBindingFile(bindingFile => {
        secondUpdateStarted = true;
        expect(
          bindingFile.bindings.every(
            binding =>
              typeof binding.metadata === 'object' &&
              binding.metadata !== null &&
              'value' in binding.metadata &&
              binding.metadata.value === 'intermediate metadata',
          ),
        ).toBe(true);

        return {
          ...bindingFile,
          bindings: bindingFile.bindings.map(binding => ({
            ...binding,
            metadata: {value: 'updated metadata'},
          })),
        };
      });

      await Promise.resolve();
      expect(secondUpdateStarted).toBe(false);
      continueFirstUpdate();
      await Promise.all([firstUpdate, secondUpdate]);
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
    expect(provider.metadataWhenCreating).toEqual({
      value: 'updated metadata canonical',
    });
    expect(provider.receivedDeviceConstructors).toEqual([TestDevice]);
    expect(
      persistedBindingFile.bindings.find(
        binding => binding.endpoint.deviceName === 'device',
      )?.metadata,
    ).toEqual({value: 'updated metadata canonical'});

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

  receivedDeviceConstructors: readonly DeviceConstructor<Device>[] | undefined;

  metadataWhenCreating: unknown;

  returnInvalidPersistedMetadata = false;

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
    deviceConstructors: readonly DeviceConstructor<Device>[],
    metadata: TestEndpointConnectionMetadata,
  ): EndpointConnectionBindingPlan<TestEndpointConnectionMetadata> {
    if (!(endpoint instanceof TestEndpoint)) {
      throw new TypeError('Unexpected test endpoint.');
    }

    this.receivedMetadata = metadata;
    this.receivedDeviceConstructors = deviceConstructors;

    return {
      prepare: async () => {
        await Promise.resolve();

        return {
          resourceKeys: [metadata.value],
          persistedMetadata: this.returnInvalidPersistedMetadata
            ? ({value: 1} as unknown as TestEndpointConnectionMetadata)
            : {value: `${metadata.value} canonical`},
          create: async () => {
            const bindingFile = await readBindingFile();

            this.metadataWhenCreating = bindingFile.bindings.find(
              binding => binding.provider.name === this.name,
            )?.metadata;

            const connection = new TestEndpointConnection(this);
            this.connectionValues.push(connection);

            return createEndpointConnectionBinding(endpoint, connection);
          },
        };
      },
    };
  }
}

class TestEndpointConnection implements EndpointConnection<TestCommand> {
  @observable accessor ready = false;

  readonly stateRevision = 0;

  constructor(readonly provider: TestProvider) {}

  @action
  setReady(): void {
    this.ready = true;
  }

  prepareCommand(command: TestCommand): CommandExecution {
    return {
      execute: async () => {
        this.provider.processedValues.push(command.value);
      },
    };
  }
}
