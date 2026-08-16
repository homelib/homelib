import {Device} from '../device.js';
import type {EndpointReference} from '../endpoint.js';
import type {RuntimeProvider} from '../provider.js';

import {
  BindingFile,
  EndpointBinding,
  EndpointPath,
  ProviderReference,
  getEndpointPathKey,
} from './binding.js';
import {
  type BootstrapBindingScope,
  type ProviderBindingDevice,
  type ProviderBindingRequest,
  applyProviderBindingRequests,
  registerBootstrapFrontend,
} from './bootstrap-frontend.js';

const PROVIDER_REFERENCE = ProviderReference.satisfies({
  namespace: 'test',
  name: 'provider',
});
const OTHER_PROVIDER_REFERENCE = ProviderReference.satisfies({
  namespace: 'other',
  name: 'provider',
});
const MAIN_PATH = createEndpointPath('main');
const AMBIENT_PATH = createEndpointPath('ambient');
const STALE_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'removed light',
  endpointName: 'main',
});
const MAIN_ENDPOINT: EndpointReference = {name: 'main', ready: false};
const AMBIENT_ENDPOINT: EndpointReference = {name: 'ambient', ready: false};
class SelectedDevice extends Device {}
class OwningDevice extends Device {}
const SELECTED_DEVICE_CONSTRUCTORS = [SelectedDevice] as const;
const OWNING_DEVICE_CONSTRUCTORS = [OwningDevice] as const;
const DEVICE: ProviderBindingDevice = {
  name: 'light',
  deviceConstructors: SELECTED_DEVICE_CONSTRUCTORS,
  endpoints: [
    {path: MAIN_PATH, endpoint: MAIN_ENDPOINT, binding: undefined},
    {path: AMBIENT_PATH, endpoint: AMBIENT_ENDPOINT, binding: undefined},
  ],
};
const SCOPES: readonly BootstrapBindingScope[] = [
  {
    path: ['home'],
    scopes: [],
    devices: [
      {
        name: 'light',
        deviceConstructors: OWNING_DEVICE_CONSTRUCTORS,
        endpoints: [
          {path: MAIN_PATH, endpoint: MAIN_ENDPOINT},
          {path: AMBIENT_PATH, endpoint: AMBIENT_ENDPOINT},
        ],
      },
    ],
  },
];
const PROVIDER: RuntimeProvider = {
  name: PROVIDER_REFERENCE.name,
  endpointConnections: [],
  createEndpointConnectionBindingPlan(_endpoint, deviceConstructors, metadata) {
    if (deviceConstructors !== OWNING_DEVICE_CONSTRUCTORS) {
      throw new TypeError('Incorrect test device owner.');
    }

    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !('resourceKey' in metadata) ||
      typeof metadata.resourceKey !== 'string'
    ) {
      throw new TypeError('Invalid test metadata.');
    }

    const resourceKey = metadata.resourceKey;

    return {
      prepare: async () => {
        await Promise.resolve();

        if (resourceKey === 'preparation failure') {
          throw new Error('test preparation failed');
        }

        return {
          resourceKeys: [resourceKey],
          persistedMetadata: {
            resourceKey,
            canonical: true,
          },
          create() {
            return Promise.resolve({bind() {}, async dispose() {}});
          },
        };
      },
    };
  },
};

test('rejects duplicate bootstrap frontend registration', () => {
  registerBootstrapFrontend(() => undefined);

  expect(() => registerBootstrapFrontend(() => undefined)).toThrow(
    'Duplicate bootstrap frontend registration.',
  );
});

test('applies a complete provider binding batch atomically', async () => {
  const bindingFile = createBindingFile([
    createBinding(MAIN_PATH, PROVIDER_REFERENCE, 'main resource'),
    createBinding(AMBIENT_PATH, PROVIDER_REFERENCE, 'ambient resource'),
  ]);
  const nextBindingFile = await applyRequests(bindingFile, [
    createRequest(MAIN_PATH, 'ambient resource'),
    createRequest(AMBIENT_PATH, 'main resource'),
  ]);

  expect(getResourceKey(nextBindingFile, MAIN_PATH)).toBe('ambient resource');
  expect(getResourceKey(nextBindingFile, AMBIENT_PATH)).toBe('main resource');
  expect(getMetadata(nextBindingFile, MAIN_PATH)).toEqual({
    resourceKey: 'ambient resource',
    canonical: true,
  });
  expect(getResourceKey(bindingFile, MAIN_PATH)).toBe('main resource');
});

test('rejects duplicate endpoints and provider resources', async () => {
  const bindingFile = createBindingFile([]);

  await expect(
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'first'),
      createRequest(MAIN_PATH, 'second'),
    ]),
  ).rejects.toThrow('Duplicate endpoint binding request');
  await expect(
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'shared'),
      createRequest(AMBIENT_PATH, 'shared'),
    ]),
  ).rejects.toThrow('Provider resource is already bound: shared.');
  expect(bindingFile.bindings).toEqual([]);
});

test('leaves the input untouched when asynchronous preparation fails', async () => {
  const bindingFile = createBindingFile([
    createBinding(MAIN_PATH, PROVIDER_REFERENCE, 'original'),
  ]);

  await expect(
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'preparation failure'),
    ]),
  ).rejects.toThrow('test preparation failed');
  expect(getMetadata(bindingFile, MAIN_PATH)).toEqual({
    resourceKey: 'original',
  });
});

test('ignores stale bindings when validating provider resources', async () => {
  const staleBinding = createBinding(STALE_PATH, PROVIDER_REFERENCE, 'shared');
  const nextBindingFile = await applyRequests(
    createBindingFile([staleBinding]),
    [createRequest(MAIN_PATH, 'shared')],
  );

  expect(nextBindingFile.bindings).toContainEqual(staleBinding);
  expect(getResourceKey(nextBindingFile, MAIN_PATH)).toBe('shared');
});

test('requires confirmation before replacing another provider', async () => {
  const bindingFile = createBindingFile([
    createBinding(MAIN_PATH, OTHER_PROVIDER_REFERENCE, 'resource'),
  ]);

  await expect(
    applyRequests(bindingFile, [createRequest(MAIN_PATH, 'resource')]),
  ).rejects.toThrow(
    'Replacing another provider binding requires confirmation.',
  );
  expect(
    (
      await applyRequests(bindingFile, [
        createRequest(MAIN_PATH, 'resource', true),
      ])
    ).bindings[0]?.provider,
  ).toEqual(PROVIDER_REFERENCE);
});

test('rejects a provider request outside its logical device', async () => {
  const unknownPath = EndpointPath.satisfies({
    scopePath: ['home'],
    deviceName: 'other light',
    endpointName: 'main',
  });

  await expect(
    applyRequests(createBindingFile([]), [
      createRequest(unknownPath, 'resource'),
    ]),
  ).rejects.toThrow('Unknown endpoint selected for binding.');
});

function applyRequests(
  bindingFile: BindingFile,
  requests: readonly ProviderBindingRequest[],
): Promise<BindingFile> {
  return applyProviderBindingRequests(
    bindingFile,
    requests,
    PROVIDER_REFERENCE,
    PROVIDER,
    DEVICE,
    SCOPES,
  );
}

function createEndpointPath(endpointName: string): EndpointPath {
  return EndpointPath.satisfies({
    scopePath: ['home'],
    deviceName: 'light',
    endpointName,
  });
}

function createBindingFile(bindings: readonly EndpointBinding[]): BindingFile {
  return BindingFile.satisfies({version: 0, bindings});
}

function createBinding(
  endpoint: EndpointPath,
  provider: EndpointBinding['provider'],
  resourceKey: string,
): EndpointBinding {
  return EndpointBinding.satisfies({
    endpoint,
    provider,
    metadata: {resourceKey},
  });
}

function createRequest(
  endpoint: EndpointPath,
  resourceKey: string,
  replaceExisting = false,
): ProviderBindingRequest {
  return {endpoint, metadata: {resourceKey}, replaceExisting};
}

function getResourceKey(
  bindingFile: BindingFile,
  endpoint: EndpointPath,
): unknown {
  const endpointPathKey = getEndpointPathKey(endpoint);
  const metadata = bindingFile.bindings.find(
    binding => getEndpointPathKey(binding.endpoint) === endpointPathKey,
  )?.metadata;

  return typeof metadata === 'object' &&
    metadata !== null &&
    'resourceKey' in metadata
    ? metadata.resourceKey
    : undefined;
}

function getMetadata(
  bindingFile: BindingFile,
  endpoint: EndpointPath,
): unknown {
  const endpointPathKey = getEndpointPathKey(endpoint);

  return bindingFile.bindings.find(
    binding => getEndpointPathKey(binding.endpoint) === endpointPathKey,
  )?.metadata;
}
