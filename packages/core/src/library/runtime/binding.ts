import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import * as x from 'x-value';

import type {DeviceEntry} from '../device.js';
import type {EndpointReference} from '../endpoint.js';
import {ProviderName} from '../provider.js';
import {type Scope, ScopePath} from '../scope.js';

import {getEnvironmentDirectory} from './environment.js';

export const EndpointPath = x.object({
  scopePath: ScopePath,
  deviceName: x.string,
  endpointName: x.string,
});

export type EndpointPath = Readonly<x.TypeOf<typeof EndpointPath>>;

export const ProviderReference = x.object({
  namespace: x.string,
  name: ProviderName,
});

export type ProviderReference = Readonly<x.TypeOf<typeof ProviderReference>>;

export const EndpointBinding = x.object({
  endpoint: EndpointPath,
  provider: ProviderReference,
  metadata: x.unknown,
});

export type EndpointBinding = Readonly<x.TypeOf<typeof EndpointBinding>>;

export const BindingFile = x.object({
  version: x.literal(0),
  bindings: x.array(EndpointBinding),
});

export type BindingFile = Readonly<x.TypeOf<typeof BindingFile>>;

export async function readBindingFile(): Promise<BindingFile> {
  const path = join(getEnvironmentDirectory(), 'bindings.json');
  let source: string;

  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {version: 0, bindings: []};
    }

    throw error;
  }

  return BindingFile.satisfies(JSON.parse(source));
}

export function getEndpointPath(
  scope: Scope,
  deviceEntry: DeviceEntry,
  endpoint: EndpointReference,
): EndpointPath {
  return {
    scopePath: scope.path,
    deviceName: deviceEntry.name,
    endpointName: endpoint.name,
  };
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT';
}
