import {assertDeclaring} from '../@lifecycle.js';
import type {EndpointReference} from '../endpoint.js';
import type {RuntimeProvider} from '../provider.js';

import {
  type BindingFile,
  type EndpointBinding,
  type EndpointPath,
  getEndpointPathKey,
  upsertEndpointBinding,
} from './binding.js';

let bootstrapFrontend: BootstrapFrontend | undefined;

export type BootstrapFrontend = (
  context: BootstrapContext,
) => void | PromiseLike<void>;

export type BootstrapContext = {
  readonly providers: readonly BootstrapProvider[];
  readonly bindingScopes: readonly BootstrapBindingScope[];
  readonly initialBindingFile: BindingFile;
  readonly updateBindingFile: (
    createNextBindingFile: (currentBindingFile: BindingFile) => BindingFile,
  ) => Promise<BindingFile>;
};

export type BootstrapProvider = {
  readonly namespace: string;
  readonly provider: RuntimeProvider;
};

export type BootstrapBindingScope = {
  readonly path: readonly string[];
  readonly scopes: readonly BootstrapBindingScope[];
  readonly devices: readonly BootstrapBindingDevice[];
};

export type BootstrapBindingDevice = {
  readonly name: string;
  readonly endpoints: readonly BootstrapBindingEndpoint[];
};

export type BootstrapBindingEndpoint = {
  readonly path: EndpointPath;
  readonly endpoint: EndpointReference;
};

export type ProviderBindingEndpoint = BootstrapBindingEndpoint & {
  readonly binding: EndpointBinding | undefined;
};

export type ProviderBindingDevice = {
  readonly name: string;
  readonly endpoints: readonly ProviderBindingEndpoint[];
};

export type ProviderBindingRecord = {
  readonly endpoint: EndpointPath;
  readonly metadata: unknown;
};

export type ProviderBindingRequest = {
  readonly endpoint: EndpointPath;
  readonly metadata: unknown;
  readonly replaceExisting: boolean;
};

export function registerBootstrapFrontend(frontend: BootstrapFrontend): void {
  assertDeclaring();

  if (bootstrapFrontend !== undefined) {
    throw new TypeError('Duplicate bootstrap frontend registration.');
  }

  bootstrapFrontend = frontend;
}

/** @internal */
export function getBootstrapFrontend(): BootstrapFrontend | undefined {
  return bootstrapFrontend;
}

export function applyProviderBindingRequests(
  bindingFile: BindingFile,
  requests: readonly ProviderBindingRequest[],
  providerReference: EndpointBinding['provider'],
  provider: RuntimeProvider,
  device: ProviderBindingDevice,
  scopes: readonly BootstrapBindingScope[],
): BindingFile {
  const endpointPathKeySet = new Set<string>();
  const resolvedRequests = requests.map(request => {
    const endpointPathKey = getEndpointPathKey(request.endpoint);

    if (endpointPathKeySet.has(endpointPathKey)) {
      throw new TypeError(
        `Duplicate endpoint binding request: ${endpointPathKey}.`,
      );
    }

    endpointPathKeySet.add(endpointPathKey);

    const endpoint = findProviderBindingEndpoint(device, request.endpoint);

    if (endpoint === undefined) {
      throw new TypeError('Unknown endpoint selected for binding.');
    }

    return {endpoint, request};
  });
  let nextBindingFile = bindingFile;

  for (const {endpoint, request} of resolvedRequests) {
    const currentBinding = findEndpointBinding(nextBindingFile, endpoint.path);

    if (
      currentBinding !== undefined &&
      (currentBinding.provider.namespace !== providerReference.namespace ||
        currentBinding.provider.name !== providerReference.name) &&
      !request.replaceExisting
    ) {
      throw new TypeError(
        'Replacing another provider binding requires confirmation.',
      );
    }

    nextBindingFile = upsertEndpointBinding(nextBindingFile, {
      endpoint: endpoint.path,
      provider: providerReference,
      metadata: request.metadata,
    });
  }

  assertProviderResourceBindingsUnique(
    nextBindingFile,
    providerReference,
    provider,
    scopes,
  );

  return nextBindingFile;
}

function assertProviderResourceBindingsUnique(
  bindingFile: BindingFile,
  providerReference: EndpointBinding['provider'],
  provider: RuntimeProvider,
  scopes: readonly BootstrapBindingScope[],
): void {
  const resourceKeySet = new Set<string>();

  for (const binding of bindingFile.bindings) {
    if (
      binding.provider.namespace !== providerReference.namespace ||
      binding.provider.name !== providerReference.name
    ) {
      continue;
    }

    const endpoint = findBootstrapBindingEndpoint(scopes, binding.endpoint);

    if (endpoint === undefined) {
      throw new Error(
        `Binding references an unknown endpoint: ${getEndpointPathKey(binding.endpoint)}.`,
      );
    }

    const plan = provider.createEndpointConnectionBindingPlan(
      endpoint.endpoint,
      binding.metadata,
    );

    for (const resourceKey of plan.resourceKeys) {
      if (resourceKeySet.has(resourceKey)) {
        throw new Error(`Provider resource is already bound: ${resourceKey}.`);
      }

      resourceKeySet.add(resourceKey);
    }
  }
}

function findProviderBindingEndpoint(
  device: ProviderBindingDevice,
  path: EndpointPath,
): ProviderBindingEndpoint | undefined {
  const pathKey = getEndpointPathKey(path);

  return device.endpoints.find(
    endpoint => getEndpointPathKey(endpoint.path) === pathKey,
  );
}

function findEndpointBinding(
  bindingFile: BindingFile,
  path: EndpointPath,
): EndpointBinding | undefined {
  const pathKey = getEndpointPathKey(path);

  return bindingFile.bindings.find(
    binding => getEndpointPathKey(binding.endpoint) === pathKey,
  );
}

function findBootstrapBindingEndpoint(
  scopes: readonly BootstrapBindingScope[],
  path: EndpointPath,
): BootstrapBindingEndpoint | undefined {
  const pathKey = getEndpointPathKey(path);

  for (const scope of scopes) {
    for (const device of scope.devices) {
      const endpoint = device.endpoints.find(
        item => getEndpointPathKey(item.path) === pathKey,
      );

      if (endpoint !== undefined) {
        return endpoint;
      }
    }

    const endpoint = findBootstrapBindingEndpoint(scope.scopes, path);

    if (endpoint !== undefined) {
      return endpoint;
    }
  }

  return undefined;
}
