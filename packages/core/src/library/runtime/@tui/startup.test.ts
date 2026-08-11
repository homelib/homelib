import type {EndpointReference} from '../../endpoint.js';
import type {RuntimeProvider} from '../../provider.js';
import {
  BindingFile,
  EndpointBinding,
  EndpointPath,
  ProviderReference,
  getEndpointPathKey,
} from '../binding.js';
import type {ProviderBindingDevice, ProviderBindingRequest} from '../tui.js';

import {
  type StartupBindingScope,
  applyProviderBindingRequests,
} from './startup.js';

const PROVIDER_REFERENCE = ProviderReference.satisfies({
  namespace: 'test',
  name: 'provider',
});
const OTHER_PROVIDER_REFERENCE = ProviderReference.satisfies({
  namespace: 'other',
  name: 'provider',
});
const MAIN_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'light',
  endpointName: 'main',
});
const AMBIENT_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'light',
  endpointName: 'ambient',
});
const OTHER_DEVICE_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'other light',
  endpointName: 'main',
});
const MAIN_ENDPOINT: EndpointReference = {name: 'main'};
const AMBIENT_ENDPOINT: EndpointReference = {name: 'ambient'};
const OTHER_DEVICE_ENDPOINT: EndpointReference = {name: 'main'};
const DEVICE: ProviderBindingDevice = {
  name: 'light',
  endpoints: [
    {path: MAIN_PATH, endpoint: MAIN_ENDPOINT, binding: undefined},
    {path: AMBIENT_PATH, endpoint: AMBIENT_ENDPOINT, binding: undefined},
  ],
};
const SCOPES: readonly StartupBindingScope[] = [
  {
    path: ['home'],
    scopes: [],
    devices: [
      {
        name: 'light',
        endpoints: [
          {path: MAIN_PATH, endpoint: MAIN_ENDPOINT},
          {path: AMBIENT_PATH, endpoint: AMBIENT_ENDPOINT},
        ],
      },
      {
        name: 'other light',
        endpoints: [{path: OTHER_DEVICE_PATH, endpoint: OTHER_DEVICE_ENDPOINT}],
      },
    ],
  },
];
const PROVIDER: RuntimeProvider = {
  name: PROVIDER_REFERENCE.name,
  endpointConnections: [],
  createEndpointConnectionBindingPlan(_endpoint, metadata) {
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !('resourceKey' in metadata) ||
      typeof metadata.resourceKey !== 'string'
    ) {
      throw new TypeError('Invalid test metadata.');
    }

    return {
      resourceKeys: [metadata.resourceKey],
      create() {
        return Promise.resolve({bind() {}});
      },
    };
  },
};

test('checks provider resource uniqueness after applying the complete batch', () => {
  const bindingFile = createBindingFile([
    createBinding(MAIN_PATH, PROVIDER_REFERENCE, 'main resource'),
    createBinding(AMBIENT_PATH, PROVIDER_REFERENCE, 'ambient resource'),
  ]);

  const nextBindingFile = applyRequests(bindingFile, [
    createRequest(MAIN_PATH, 'ambient resource'),
    createRequest(AMBIENT_PATH, 'main resource'),
  ]);

  expect(getResourceKey(nextBindingFile, MAIN_PATH)).toBe('ambient resource');
  expect(getResourceKey(nextBindingFile, AMBIENT_PATH)).toBe('main resource');
  expect(getResourceKey(bindingFile, MAIN_PATH)).toBe('main resource');
  expect(getResourceKey(bindingFile, AMBIENT_PATH)).toBe('ambient resource');
});

test('rejects duplicate endpoint requests', () => {
  const bindingFile = createBindingFile([]);

  expect(() =>
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'first resource'),
      createRequest(MAIN_PATH, 'second resource'),
    ]),
  ).toThrow('Duplicate endpoint binding request');
  expect(bindingFile.bindings).toEqual([]);
});

test('rejects the whole batch when a later endpoint is outside the device', () => {
  const bindingFile = createBindingFile([]);

  expect(() =>
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'main resource'),
      createRequest(OTHER_DEVICE_PATH, 'other resource'),
    ]),
  ).toThrow('Unknown endpoint selected for binding.');
  expect(bindingFile.bindings).toEqual([]);
});

test('requires replacement confirmation for each endpoint request', () => {
  const bindingFile = createBindingFile([
    createBinding(MAIN_PATH, OTHER_PROVIDER_REFERENCE, 'main resource'),
    createBinding(AMBIENT_PATH, OTHER_PROVIDER_REFERENCE, 'ambient resource'),
  ]);

  expect(() =>
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'main resource', true),
      createRequest(AMBIENT_PATH, 'ambient resource'),
    ]),
  ).toThrow('Replacing another provider binding requires confirmation.');

  const nextBindingFile = applyRequests(bindingFile, [
    createRequest(MAIN_PATH, 'main resource', true),
    createRequest(AMBIENT_PATH, 'ambient resource', true),
  ]);

  expect(nextBindingFile.bindings).toHaveLength(2);
  expect(
    nextBindingFile.bindings.every(
      binding => binding.provider.namespace === PROVIDER_REFERENCE.namespace,
    ),
  ).toBe(true);
  expect(
    bindingFile.bindings.every(
      binding =>
        binding.provider.namespace === OTHER_PROVIDER_REFERENCE.namespace,
    ),
  ).toBe(true);
});

test('rejects resource conflicts introduced by the complete batch', () => {
  const bindingFile = createBindingFile([]);

  expect(() =>
    applyRequests(bindingFile, [
      createRequest(MAIN_PATH, 'shared resource'),
      createRequest(AMBIENT_PATH, 'shared resource'),
    ]),
  ).toThrow('Provider resource is already bound: shared resource.');
  expect(bindingFile.bindings).toEqual([]);
});

function applyRequests(
  bindingFile: BindingFile,
  requests: readonly ProviderBindingRequest[],
): BindingFile {
  return applyProviderBindingRequests(
    bindingFile,
    requests,
    PROVIDER_REFERENCE,
    PROVIDER,
    DEVICE,
    SCOPES,
  );
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

  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'resourceKey' in metadata
  ) {
    return metadata.resourceKey;
  }

  return undefined;
}
