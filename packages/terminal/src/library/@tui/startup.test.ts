import {
  BindingFile,
  type BootstrapBindingDevice,
  Device,
  EndpointPath,
  type EndpointReference,
} from '@homelib/core';

import {createProviderBindingDevice} from './startup.js';

class TestDevice extends Device {}

const ENDPOINT_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'light',
  endpointName: '',
});
const ENDPOINT: EndpointReference = {name: '', ready: false};
const DEVICE_CONSTRUCTORS = [TestDevice] as const;
const DEVICE: BootstrapBindingDevice = {
  name: 'light',
  deviceConstructors: DEVICE_CONSTRUCTORS,
  endpoints: [{path: ENDPOINT_PATH, endpoint: ENDPOINT}],
};

test('preserves logical device constructor identity for provider binding', () => {
  const bindingFile = BindingFile.satisfies({
    version: 0,
    bindings: [
      {
        endpoint: ENDPOINT_PATH,
        provider: {namespace: 'test', name: 'provider'},
        metadata: {resource: 'light'},
      },
    ],
  });

  const providerBindingDevice = createProviderBindingDevice(
    DEVICE,
    bindingFile,
  );

  expect(providerBindingDevice.deviceConstructors).toBe(DEVICE_CONSTRUCTORS);
  expect(providerBindingDevice.endpoints).toEqual([
    {
      path: ENDPOINT_PATH,
      endpoint: ENDPOINT,
      binding: bindingFile.bindings[0],
    },
  ]);
});
