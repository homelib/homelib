import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import * as x from 'x-value';

import type {
  Device as CoreDevice,
  DeviceConstructor,
  DeviceEntry,
} from '../../device.js';
import type {
  EndpointConnection,
  EndpointConnectionBinding,
  EndpointReference,
} from '../../endpoint.js';
import type {EndpointConnectionBindingPlan} from '../../provider.js';
import type {BindingFile} from '../../runtime/binding.js';

const TestMetadata = x.object({value: x.string});

type TestMetadata = x.TypeOf<typeof TestMetadata>;

test('does not persist or create when binding preparation fails', async () => {
  const preparationError = new Error('preparation failed');

  await withBootstrapHarness(
    {
      devices: [{name: 'device', value: 'original'}],
      prepareFailureValue: 'original',
      preparationError,
    },
    async harness => {
      await expect(harness.bootstrap()).rejects.toBe(preparationError);
      await expect(harness.readBindingFile()).resolves.toEqual(
        harness.initialBindingFile,
      );
      expect(harness.create).not.toHaveBeenCalled();
    },
  );
});

test('does not persist or create when prepared resources conflict', async () => {
  await withBootstrapHarness(
    {
      devices: [
        {name: 'first', value: 'first'},
        {name: 'second', value: 'second'},
      ],
      getResourceKey: () => 'shared',
    },
    async harness => {
      await expect(harness.bootstrap()).rejects.toThrow(
        'Duplicate provider resource binding',
      );
      await expect(harness.readBindingFile()).resolves.toEqual(
        harness.initialBindingFile,
      );
      expect(harness.prepare).toHaveBeenCalledTimes(2);
      expect(harness.create).not.toHaveBeenCalled();
    },
  );
});

test('does not create bindings when canonical metadata cannot be written', async () => {
  await withBootstrapHarness(
    {
      devices: [{name: 'device', value: 'original'}],
      preventBindingFileWrites: true,
    },
    async harness => {
      await expect(harness.bootstrap()).rejects.toMatchObject({code: 'EACCES'});
      expect(harness.prepare).toHaveBeenCalledTimes(1);
      expect(harness.create).not.toHaveBeenCalled();
    },
  );
});

test('keeps canonical metadata committed when one binding creation fails', async () => {
  const creationError = new Error('creation failed');

  await withBootstrapHarness(
    {
      devices: [
        {name: 'first', value: 'created'},
        {name: 'second', value: 'fails'},
      ],
      createFailureValue: 'fails',
      creationError,
    },
    async harness => {
      await expect(harness.bootstrap()).rejects.toBe(creationError);
      expect(harness.create).toHaveBeenCalledTimes(2);
      expect(harness.bindings.get('created')?.dispose).toHaveBeenCalledTimes(1);
      expect(harness.bindings.get('created')?.bind).not.toHaveBeenCalled();

      const bindingFile = await harness.readBindingFile();

      expect(
        Object.fromEntries(
          bindingFile.bindings.map(binding => [
            binding.endpoint.deviceName,
            binding.metadata,
          ]),
        ),
      ).toEqual({
        first: {value: 'created canonical'},
        second: {value: 'fails canonical'},
      });
    },
  );
});

async function withBootstrapHarness(
  options: BootstrapHarnessOptions,
  run: (harness: BootstrapHarness) => PromiseLike<void>,
): Promise<void> {
  import.meta.jest.resetModules();

  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-bootstrap-atomicity-test-'),
  );
  const originalEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;

  process.env.HOMELIB_DIRECTORY = environmentDirectory;

  try {
    const [
      {Device},
      {Endpoint},
      {Provider},
      {register, registerRootScope},
      {Scope},
      {readBindingFile, writeBindingFile},
      {bootstrap},
    ] = await Promise.all([
      import('../../device.js'),
      import('../../endpoint.js'),
      import('../../provider.js'),
      import('../../registry.js'),
      import('../../scope.js'),
      import('../../runtime/binding.js'),
      import('../../runtime/bootstrap.js'),
    ]);
    const prepare = import.meta.jest.fn();
    const create = import.meta.jest.fn();
    const bindings = new Map<string, TestBinding>();

    class TestEndpoint extends Endpoint<never> {}

    class TestDevice extends Device {
      constructor(entry: DeviceEntry) {
        super(entry);
        this.getOrCreateEndpoint(TestEndpoint);
      }
    }

    class TestProvider extends Provider<TestMetadata> {
      override readonly EndpointConnectionMetadata = TestMetadata;

      override get endpointConnections(): readonly EndpointConnection<never>[] {
        return [];
      }

      protected override createEndpointConnectionBindingPlanFromMetadata(
        _endpoint: EndpointReference,
        _deviceConstructors: readonly DeviceConstructor<CoreDevice>[],
        metadata: TestMetadata,
      ): EndpointConnectionBindingPlan<TestMetadata> {
        return {
          prepare: async () => {
            prepare(metadata.value);

            if (metadata.value === options.prepareFailureValue) {
              throw options.preparationError;
            }

            return {
              resourceKeys: [
                options.getResourceKey?.(metadata.value) ?? metadata.value,
              ],
              persistedMetadata: {value: `${metadata.value} canonical`},
              create: async (): Promise<EndpointConnectionBinding> => {
                create(metadata.value);

                if (metadata.value === options.createFailureValue) {
                  throw options.creationError;
                }

                const binding = createTestBinding();
                bindings.set(metadata.value, binding);
                return binding;
              },
            };
          },
        };
      }
    }

    const provider = new TestProvider('provider');
    const home = new Scope('home');

    register('test', provider);
    registerRootScope(home);

    for (const {name} of options.devices) {
      home.createDeviceEntry(name).createInstance(TestDevice);
    }

    const initialBindingFile: BindingFile = {
      version: 0,
      bindings: options.devices.map(({name, value}) => ({
        endpoint: {
          scopePath: home.path,
          deviceName: name,
          endpointName: '',
        },
        provider: {namespace: 'test', name: provider.name},
        metadata: {value},
      })),
    };

    await writeBindingFile(initialBindingFile);

    if (options.preventBindingFileWrites) {
      await chmod(environmentDirectory, 0o500);
    }

    await run({
      bootstrap,
      readBindingFile,
      initialBindingFile,
      prepare,
      create,
      bindings,
    });
  } finally {
    await chmod(environmentDirectory, 0o700);

    if (originalEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = originalEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
}

function createTestBinding(): TestBinding {
  return {
    bind: import.meta.jest.fn(),
    dispose: import.meta.jest.fn(async () => undefined),
  };
}

type BootstrapHarnessOptions = {
  readonly devices: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly prepareFailureValue?: string;
  readonly preparationError?: Error;
  readonly createFailureValue?: string;
  readonly creationError?: Error;
  readonly getResourceKey?: (value: string) => string;
  readonly preventBindingFileWrites?: boolean;
};

type BootstrapHarness = {
  readonly bootstrap: () => Promise<void>;
  readonly readBindingFile: () => Promise<BindingFile>;
  readonly initialBindingFile: BindingFile;
  readonly prepare: jest.Mock;
  readonly create: jest.Mock;
  readonly bindings: ReadonlyMap<string, TestBinding>;
};

type TestBinding = {
  readonly bind: jest.Mock;
  readonly dispose: jest.Mock;
};
