import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import {beginRun, completeRun, failRun} from '../@lifecycle.js';
import type {EndpointReference} from '../endpoint.js';
import type {EndpointConnectionBindingPlan} from '../provider.js';
import {getProvider, getRootScopes} from '../registry.js';
import type {Scope} from '../scope.js';

import {BindingFile, type EndpointPath, getEndpointPath} from './binding.js';
import {getEnvironmentDirectory} from './environment.js';

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
  const bindingFile = await readBindingFile();
  const endpointMap = collectEndpoints();
  const bindingPathSet = new Set<string>();
  const connectionBindingPlans: EndpointConnectionBindingPlan[] = [];

  for (const binding of bindingFile.bindings) {
    const pathKey = getPathKey(binding.endpoint);

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

    connectionBindingPlans.push(
      provider.createEndpointConnectionBindingPlan(endpoint, binding.metadata),
    );
  }

  for (const pathKey of endpointMap.keys()) {
    if (!bindingPathSet.has(pathKey)) {
      throw new Error(`Endpoint has no binding: ${pathKey}.`);
    }
  }

  const connectionBindings = await Promise.all(
    connectionBindingPlans.map(async plan => plan.create()),
  );

  for (const connectionBinding of connectionBindings) {
    connectionBinding.bind();
  }
}

async function readBindingFile(): Promise<BindingFile> {
  const path = join(getEnvironmentDirectory(), 'bindings.json');
  const source = await readFile(path, 'utf8');

  return BindingFile.satisfies(JSON.parse(source));
}

function collectEndpoints(): Map<string, EndpointReference> {
  const endpointMap = new Map<string, EndpointReference>();

  for (const rootScope of getRootScopes()) {
    collectScopeEndpoints(rootScope, endpointMap);
  }

  return endpointMap;
}

function collectScopeEndpoints(
  scope: Scope,
  endpointMap: Map<string, EndpointReference>,
): void {
  for (const deviceEntry of scope.devices) {
    for (const endpoint of deviceEntry.endpoints) {
      const path = getEndpointPath(scope, deviceEntry, endpoint);
      const pathKey = getPathKey(path);

      if (endpointMap.has(pathKey)) {
        throw new Error(`Duplicate logical endpoint path: ${pathKey}.`);
      }

      endpointMap.set(pathKey, endpoint);
    }
  }

  for (const childScope of scope.scopes) {
    collectScopeEndpoints(childScope, endpointMap);
  }
}

function getPathKey(path: EndpointPath): string {
  return JSON.stringify([path.scopePath, path.deviceName, path.endpointName]);
}
