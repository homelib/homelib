import {assertDeclaring} from '../@lifecycle.js';
import type {Device, DeviceConstructor} from '../device.js';
import type {EndpointReference} from '../endpoint.js';
import type {RuntimeProvider} from '../provider.js';

import {prepareEndpointConnectionBindingPlans} from './@binding-creation.js';
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
    createNextBindingFile: (
      currentBindingFile: BindingFile,
    ) => BindingFile | PromiseLike<BindingFile>,
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
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
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
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
  readonly endpoints: readonly ProviderBindingEndpoint[];
};

export type ProviderBindingRecord = {
  readonly endpoint: EndpointPath;
  readonly endpointReference: EndpointReference;
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
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

export async function applyProviderBindingRequests(
  bindingFile: BindingFile,
  requests: readonly ProviderBindingRequest[],
  providerReference: EndpointBinding['provider'],
  provider: RuntimeProvider,
  device: ProviderBindingDevice,
  scopes: readonly BootstrapBindingScope[],
): Promise<BindingFile> {
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

  return prepareProviderResourceBindings(
    nextBindingFile,
    providerReference,
    provider,
    scopes,
  );
}

async function prepareProviderResourceBindings(
  bindingFile: BindingFile,
  providerReference: EndpointBinding['provider'],
  provider: RuntimeProvider,
  scopes: readonly BootstrapBindingScope[],
): Promise<BindingFile> {
  const planEntries = [];

  for (const binding of bindingFile.bindings) {
    if (
      binding.provider.namespace !== providerReference.namespace ||
      binding.provider.name !== providerReference.name
    ) {
      continue;
    }

    const target = findBootstrapBindingEndpoint(scopes, binding.endpoint);

    if (target === undefined) {
      // Stale bindings remain persisted for frontend inspection and cleanup,
      // but do not reserve provider resources in the current topology.
      continue;
    }

    const plan = provider.createEndpointConnectionBindingPlan(
      target.endpoint.endpoint,
      target.deviceConstructors,
      binding.metadata,
    );

    planEntries.push({binding, plan});
  }

  const preparedPlans = await prepareEndpointConnectionBindingPlans(
    planEntries.map(({plan}) => plan),
  );
  const resourceKeySet = new Set<string>();
  let nextBindingFile = bindingFile;

  for (const [index, {binding}] of planEntries.entries()) {
    const plan = preparedPlans[index];

    if (plan === undefined) {
      throw new Error('Prepared endpoint connection binding plan is missing.');
    }

    for (const resourceKey of plan.resourceKeys) {
      if (resourceKeySet.has(resourceKey)) {
        throw new Error(`Provider resource is already bound: ${resourceKey}.`);
      }

      resourceKeySet.add(resourceKey);
    }

    nextBindingFile = upsertEndpointBinding(nextBindingFile, {
      ...binding,
      metadata: plan.persistedMetadata,
    });
  }

  return nextBindingFile;
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
): BootstrapBindingEndpointTarget | undefined {
  const pathKey = getEndpointPathKey(path);

  for (const scope of scopes) {
    for (const device of scope.devices) {
      const endpoint = device.endpoints.find(
        item => getEndpointPathKey(item.path) === pathKey,
      );

      if (endpoint !== undefined) {
        return {
          endpoint,
          deviceConstructors: device.deviceConstructors,
        };
      }
    }

    const endpoint = findBootstrapBindingEndpoint(scope.scopes, path);

    if (endpoint !== undefined) {
      return endpoint;
    }
  }

  return undefined;
}

type BootstrapBindingEndpointTarget = {
  readonly endpoint: BootstrapBindingEndpoint;
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
};
