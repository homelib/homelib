import {randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';

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
  const path = getBindingFilePath();
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

export async function writeBindingFile(file: BindingFile): Promise<void> {
  const validatedFile = BindingFile.satisfies(file);
  const path = getBindingFilePath();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;

  await mkdir(dirname(path), {recursive: true, mode: 0o700});

  try {
    const handle = await open(temporaryPath, 'wx', 0o600);

    try {
      await handle.writeFile(
        `${JSON.stringify(validatedFile, undefined, 2)}\n`,
      );
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, {force: true});
  }
}

export function upsertEndpointBinding(
  file: BindingFile,
  binding: EndpointBinding,
): BindingFile {
  const validatedBinding = EndpointBinding.satisfies(binding);
  const bindings = file.bindings.filter(
    item => !endpointPathsEqual(item.endpoint, validatedBinding.endpoint),
  );

  bindings.push(validatedBinding);
  bindings.sort(compareEndpointBindings);

  return {version: 0, bindings};
}

export function removeEndpointBinding(
  file: BindingFile,
  endpoint: EndpointPath,
): BindingFile {
  const validatedEndpoint = EndpointPath.satisfies(endpoint);

  return {
    version: 0,
    bindings: file.bindings.filter(
      binding => !endpointPathsEqual(binding.endpoint, validatedEndpoint),
    ),
  };
}

export function getEndpointPathKey(path: EndpointPath): string {
  return JSON.stringify([path.scopePath, path.deviceName, path.endpointName]);
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

function getBindingFilePath(): string {
  return join(getEnvironmentDirectory(), 'bindings.json');
}

function endpointPathsEqual(left: EndpointPath, right: EndpointPath): boolean {
  return getEndpointPathKey(left) === getEndpointPathKey(right);
}

function compareEndpointBindings(
  left: EndpointBinding,
  right: EndpointBinding,
): number {
  return compareStrings(
    getEndpointPathKey(left.endpoint),
    getEndpointPathKey(right.endpoint),
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  }

  return 0;
}
