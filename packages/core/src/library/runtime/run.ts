import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import {beginRun, completeRun, failRun} from '../@lifecycle.js';
import type {Command} from '../command.js';
import type {Endpoint, EndpointConnectionMetadata} from '../endpoint.js';
import type {Provider} from '../provider.js';
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
  const bindingPlans: BindingPlan[] = [];

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

    const metadata = provider.EndpointConnectionMetadata.satisfies(
      binding.metadata,
    );

    bindingPlans.push({endpoint, provider, metadata});
  }

  for (const pathKey of endpointMap.keys()) {
    if (!bindingPathSet.has(pathKey)) {
      throw new Error(`Endpoint has no binding: ${pathKey}.`);
    }
  }

  const connections = await Promise.all(
    bindingPlans.map(async ({endpoint, provider, metadata}) => {
      const connection = await provider.createEndpointConnection(
        endpoint,
        metadata,
      );

      if (connection.provider !== provider) {
        throw new Error(
          'Provider created an endpoint connection for another provider.',
        );
      }

      return connection;
    }),
  );

  for (const [index, {endpoint}] of bindingPlans.entries()) {
    const connection = connections[index];

    if (connection === undefined) {
      throw new Error('Created endpoint connection is missing.');
    }

    endpoint.bindConnection(connection);
  }
}

async function readBindingFile(): Promise<BindingFile> {
  const path = join(getEnvironmentDirectory(), 'bindings.json');
  const source = await readFile(path, 'utf8');

  return BindingFile.satisfies(JSON.parse(source));
}

function collectEndpoints(): Map<string, Endpoint<Command>> {
  const endpointMap = new Map<string, Endpoint<Command>>();

  for (const rootScope of getRootScopes()) {
    collectScopeEndpoints(rootScope, endpointMap);
  }

  return endpointMap;
}

function collectScopeEndpoints(
  scope: Scope,
  endpointMap: Map<string, Endpoint<Command>>,
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

type BindingPlan = {
  readonly endpoint: Endpoint<Command>;
  readonly provider: Provider<Command>;
  readonly metadata: EndpointConnectionMetadata;
};
