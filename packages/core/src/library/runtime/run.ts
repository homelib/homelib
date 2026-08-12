import {basename} from 'node:path';

import {beginRun, completeRun, failRun} from '../@lifecycle.js';
import type {EndpointReference} from '../endpoint.js';
import {setEndpointLogTarget} from '../log.js';
import type {EndpointConnectionBindingPlan} from '../provider.js';
import {getProvider, getProviderEntries, getRootScopes} from '../registry.js';
import type {Scope} from '../scope.js';

import {type StartupBindingScope, presentStartup} from './@tui/startup.js';
import {
  type BindingFile,
  type EndpointPath,
  getEndpointPath,
  getEndpointPathKey,
  readBindingFile,
} from './binding.js';

export function run(): Promise<void> {
  beginRun();

  return runInternal().then(
    () => {
      completeRun();
    },
    error => {
      failRun();
      throw error;
    },
  );
}

async function runInternal(): Promise<void> {
  const initialBindingFile = await readBindingFile();
  const rootScopes = [...getRootScopes()];
  const {scopes, endpointMap} = collectBindingTopology(rootScopes);

  await presentStartup({
    scriptName: getScriptName(),
    providers: Array.from(getProviderEntries(), ([namespace, provider]) => ({
      namespace,
      provider,
    })),
    bindingScopes: scopes,
    bindingFile: initialBindingFile,
  });

  const bindingFile = await readBindingFile();
  const connectionBindingPlans = createConnectionBindingPlans(
    bindingFile,
    endpointMap,
  );

  // TODO: add a disposal contract before plans may allocate independent
  // resources that need rollback when another plan fails to create.
  const connectionBindings = await Promise.all(
    connectionBindingPlans.map(async item => ({
      ...item,
      binding: await item.plan.create(),
    })),
  );

  for (const {binding, endpoint, path} of connectionBindings) {
    setEndpointLogTarget(endpoint, path);
    binding.bind();
  }
}

function collectBindingTopology(rootScopes: readonly Scope[]): {
  readonly scopes: readonly StartupBindingScope[];
  readonly endpointMap: ReadonlyMap<string, EndpointReference>;
} {
  const endpointMap = new Map<string, EndpointReference>();
  const scopePathSet = new Set<string>();
  const scopes = rootScopes.map(scope =>
    collectBindingScope(scope, endpointMap, scopePathSet),
  );

  return {scopes, endpointMap};
}

function collectBindingScope(
  scope: Scope,
  endpointMap: Map<string, EndpointReference>,
  scopePathSet: Set<string>,
): StartupBindingScope {
  const scopePathKey = getScopePathKey(scope);

  if (scopePathSet.has(scopePathKey)) {
    throw new Error(`Duplicate logical scope path: ${scopePathKey}.`);
  }

  scopePathSet.add(scopePathKey);

  const devices = Array.from(scope.devices, deviceEntry => ({
    name: deviceEntry.name,
    endpoints: Array.from(deviceEntry.endpoints, endpoint => {
      const path = getEndpointPath(scope, deviceEntry, endpoint);
      const pathKey = getEndpointPathKey(path);

      if (endpointMap.has(pathKey)) {
        throw new Error(`Duplicate logical endpoint path: ${pathKey}.`);
      }

      endpointMap.set(pathKey, endpoint);

      return {path, endpoint};
    }),
  }));

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
  endpointMap: ReadonlyMap<string, EndpointReference>,
): readonly EndpointConnectionBindingPlanEntry[] {
  const bindingPathSet = new Set<string>();
  const providerResourceKeySet = new Set<string>();
  const plans: EndpointConnectionBindingPlanEntry[] = [];

  for (const binding of bindingFile.bindings) {
    const pathKey = getEndpointPathKey(binding.endpoint);

    if (bindingPathSet.has(pathKey)) {
      throw new Error(`Duplicate endpoint binding: ${pathKey}.`);
    }

    bindingPathSet.add(pathKey);

    const endpoint = endpointMap.get(pathKey);

    if (endpoint === undefined) {
      throw new Error(`Binding references an unknown endpoint: ${pathKey}.`);
    }

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
      endpoint,
      binding.metadata,
    );

    for (const resourceKey of plan.resourceKeys) {
      const providerResourceKey = JSON.stringify([
        binding.provider.namespace,
        binding.provider.name,
        resourceKey,
      ]);

      if (providerResourceKeySet.has(providerResourceKey)) {
        throw new Error(
          `Duplicate provider resource binding: ${providerResourceKey}.`,
        );
      }

      providerResourceKeySet.add(providerResourceKey);
    }

    plans.push({path: binding.endpoint, endpoint, plan});
  }

  return plans;
}

type EndpointConnectionBindingPlanEntry = {
  readonly path: EndpointPath;
  readonly endpoint: EndpointReference;
  readonly plan: EndpointConnectionBindingPlan;
};

function getScopePathKey(scope: Scope): string {
  return JSON.stringify(scope.path);
}

function getScriptName(): string {
  const scriptPath = process.argv.at(1);

  if (scriptPath === undefined) {
    return 'automation';
  }

  return basename(scriptPath);
}
