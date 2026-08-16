import {isDeepStrictEqual} from 'node:util';

import {
  beginBootstrap,
  completeBootstrap,
  failBootstrap,
} from '../@lifecycle.js';
import type {Device, DeviceConstructor} from '../device.js';
import type {EndpointReference} from '../endpoint.js';
import {setEndpointLogTarget} from '../log.js';
import type {
  EndpointConnectionBindingPlan,
  PreparedEndpointConnectionBindingPlan,
} from '../provider.js';
import {getProvider, getProviderEntries, getRootScopes} from '../registry.js';
import type {Scope} from '../scope.js';

import {
  createEndpointConnectionBindings,
  disposeEndpointConnectionBindings,
  prepareEndpointConnectionBindingPlans,
} from './@binding-creation.js';
import {
  BindingFile,
  type EndpointBinding,
  type EndpointPath,
  getEndpointPath,
  getEndpointPathKey,
  readBindingFile,
  upsertEndpointBinding,
  writeBindingFile,
} from './binding.js';
import {
  type BootstrapBindingScope,
  type BootstrapContext,
  getBootstrapFrontend,
} from './bootstrap-frontend.js';

/**
 * Finalizes declarations and binds all configured endpoint connections.
 *
 * Resolves after every binding is installed. Individual endpoints may still be
 * waiting to become ready; commands issued after this promise resolves remain
 * queued until their connection is ready. A registered bootstrap frontend may
 * inspect and update bindings before connections are created.
 */
export function bootstrap(): Promise<void> {
  beginBootstrap();

  return bootstrapInternal().then(
    () => {
      completeBootstrap();
    },
    error => {
      failBootstrap();
      throw error;
    },
  );
}

async function bootstrapInternal(): Promise<void> {
  const initialBindingFile = await readBindingFile();
  const rootScopes = [...getRootScopes()];
  const {scopes, endpointMap} = collectBindingTopology(rootScopes);
  const {context, close} = createBootstrapContext(initialBindingFile, scopes);
  const frontend = getBootstrapFrontend();

  try {
    await frontend?.(context);
  } finally {
    await close();
  }

  const bindingFile = await readBindingFile();
  const connectionBindingPlans = await prepareConnectionBindingPlans(
    createConnectionBindingPlans(bindingFile, endpointMap),
  );
  const canonicalBindingFile = applyPreparedBindingMetadata(
    bindingFile,
    connectionBindingPlans,
  );

  if (!isDeepStrictEqual(canonicalBindingFile, bindingFile)) {
    await writeBindingFile(canonicalBindingFile);
  }

  const bindings = await createEndpointConnectionBindings(
    connectionBindingPlans.map(({plan}) => plan),
  );

  try {
    for (const [index, binding] of bindings.entries()) {
      const item = connectionBindingPlans[index];

      if (item === undefined) {
        throw new Error('Endpoint connection binding plan is missing.');
      }

      const {endpoint, path} = item;
      setEndpointLogTarget(endpoint, path);
      binding.bind();
    }
  } catch (error) {
    const disposalErrors = await disposeEndpointConnectionBindings(bindings);

    if (disposalErrors.length === 0) {
      throw error;
    }

    throw new AggregateError(
      [error, ...disposalErrors],
      'Failed to bind endpoint connections.',
      {cause: error},
    );
  }
}

function collectBindingTopology(rootScopes: readonly Scope[]): {
  readonly scopes: readonly BootstrapBindingScope[];
  readonly endpointMap: ReadonlyMap<string, BindingTopologyEndpoint>;
} {
  const endpointMap = new Map<string, BindingTopologyEndpoint>();
  const scopePathSet = new Set<string>();
  const scopes = rootScopes.map(scope =>
    collectBindingScope(scope, endpointMap, scopePathSet),
  );

  return {scopes, endpointMap};
}

function collectBindingScope(
  scope: Scope,
  endpointMap: Map<string, BindingTopologyEndpoint>,
  scopePathSet: Set<string>,
): BootstrapBindingScope {
  const scopePathKey = getScopePathKey(scope);

  if (scopePathSet.has(scopePathKey)) {
    throw new Error(`Duplicate logical scope path: ${scopePathKey}.`);
  }

  scopePathSet.add(scopePathKey);

  const devices = Array.from(scope.devices, deviceEntry => {
    const deviceConstructors = Array.from(deviceEntry.constructors);

    return {
      name: deviceEntry.name,
      deviceConstructors,
      endpoints: Array.from(deviceEntry.endpoints, endpoint => {
        const path = getEndpointPath(scope, deviceEntry, endpoint);
        const pathKey = getEndpointPathKey(path);

        if (endpointMap.has(pathKey)) {
          throw new Error(`Duplicate logical endpoint path: ${pathKey}.`);
        }

        endpointMap.set(pathKey, {endpoint, deviceConstructors});

        return {path, endpoint};
      }),
    };
  });

  return {
    path: scope.path,
    scopes: Array.from(scope.scopes, childScope =>
      collectBindingScope(childScope, endpointMap, scopePathSet),
    ),
    devices,
  };
}

function createConnectionBindingPlans(
  bindingFile: BindingFile,
  endpointMap: ReadonlyMap<string, BindingTopologyEndpoint>,
): readonly EndpointConnectionBindingPlanEntry[] {
  const bindingPathSet = new Set<string>();
  const plans: EndpointConnectionBindingPlanEntry[] = [];

  for (const binding of bindingFile.bindings) {
    const pathKey = getEndpointPathKey(binding.endpoint);
    const target = endpointMap.get(pathKey);

    // Keep stale bindings available to bootstrap frontends for inspection and
    // cleanup, but do not let declarations removed from the current script
    // prevent the remaining endpoints from starting.
    if (target === undefined) {
      continue;
    }

    if (bindingPathSet.has(pathKey)) {
      throw new Error(`Duplicate endpoint binding: ${pathKey}.`);
    }

    bindingPathSet.add(pathKey);

    const provider = getProvider(
      binding.provider.namespace,
      binding.provider.name,
    );

    if (provider === undefined) {
      throw new Error(
        `Binding references an unknown provider: ${binding.provider.namespace}/${binding.provider.name}.`,
      );
    }

    const plan = provider.createEndpointConnectionBindingPlan(
      target.endpoint,
      target.deviceConstructors,
      binding.metadata,
    );

    plans.push({
      binding,
      path: binding.endpoint,
      endpoint: target.endpoint,
      plan,
    });
  }

  return plans;
}

async function prepareConnectionBindingPlans(
  entries: readonly EndpointConnectionBindingPlanEntry[],
): Promise<readonly PreparedEndpointConnectionBindingPlanEntry[]> {
  const preparedPlans = await prepareEndpointConnectionBindingPlans(
    entries.map(({plan}) => plan),
  );
  const providerResourceKeySet = new Set<string>();

  return entries.map((entry, index) => {
    const preparedPlan = preparedPlans[index];

    if (preparedPlan === undefined) {
      throw new Error('Prepared endpoint connection binding plan is missing.');
    }

    for (const resourceKey of preparedPlan.resourceKeys) {
      const providerResourceKey = JSON.stringify([
        entry.binding.provider.namespace,
        entry.binding.provider.name,
        resourceKey,
      ]);

      if (providerResourceKeySet.has(providerResourceKey)) {
        throw new Error(
          `Duplicate provider resource binding: ${providerResourceKey}.`,
        );
      }

      providerResourceKeySet.add(providerResourceKey);
    }

    return {...entry, plan: preparedPlan};
  });
}

function applyPreparedBindingMetadata(
  bindingFile: BindingFile,
  entries: readonly PreparedEndpointConnectionBindingPlanEntry[],
): BindingFile {
  let nextBindingFile = bindingFile;

  for (const {binding, plan} of entries) {
    nextBindingFile = upsertEndpointBinding(nextBindingFile, {
      ...binding,
      metadata: plan.persistedMetadata,
    });
  }

  return nextBindingFile;
}

type EndpointConnectionBindingPlanEntry = {
  readonly binding: EndpointBinding;
  readonly path: EndpointPath;
  readonly endpoint: EndpointReference;
  readonly plan: EndpointConnectionBindingPlan;
};

type PreparedEndpointConnectionBindingPlanEntry = Omit<
  EndpointConnectionBindingPlanEntry,
  'plan'
> & {
  readonly plan: PreparedEndpointConnectionBindingPlan;
};

type BindingTopologyEndpoint = {
  readonly endpoint: EndpointReference;
  readonly deviceConstructors: readonly DeviceConstructor<Device>[];
};

function getScopePathKey(scope: Scope): string {
  return JSON.stringify(scope.path);
}

function createBootstrapContext(
  initialBindingFile: BindingFile,
  bindingScopes: readonly BootstrapBindingScope[],
): {
  readonly context: BootstrapContext;
  readonly close: () => Promise<void>;
} {
  let bindingFile = initialBindingFile;
  let bindingFileUpdateQueue = Promise.resolve();
  let active = true;

  const context: BootstrapContext = {
    providers: Array.from(getProviderEntries(), ([namespace, provider]) => ({
      namespace,
      provider,
    })),
    bindingScopes,
    initialBindingFile,
    updateBindingFile(createNextBindingFile) {
      if (!active) {
        return Promise.reject(new Error('Bootstrap context is closed.'));
      }

      const operation = bindingFileUpdateQueue.then(async () => {
        const nextBindingFile = BindingFile.satisfies(
          await createNextBindingFile(bindingFile),
        );

        await writeBindingFile(nextBindingFile);
        bindingFile = nextBindingFile;
        return nextBindingFile;
      });

      bindingFileUpdateQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };

  return {
    context,
    async close() {
      active = false;
      await bindingFileUpdateQueue;
    },
  };
}
