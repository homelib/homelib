import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  EndpointBinding,
  EndpointPath,
  readBindingFile,
  removeEndpointBinding,
  upsertEndpointBinding,
  writeBindingFile,
} from './binding.js';

test('loads missing bindings as empty and rejects invalid bindings', async () => {
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-binding-test-'),
  );
  const originalEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;

  process.env.HOMELIB_DIRECTORY = environmentDirectory;

  try {
    await expect(readBindingFile()).resolves.toEqual({
      version: 0,
      bindings: [],
    });

    await writeFile(
      join(environmentDirectory, 'bindings.json'),
      JSON.stringify({version: 1, bindings: []}),
    );

    await expect(readBindingFile()).rejects.toThrow(
      'Value does not satisfy the type',
    );
  } finally {
    if (originalEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = originalEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});

test('atomically replaces and removes endpoint bindings', async () => {
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-binding-write-test-'),
  );
  const originalEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;

  process.env.HOMELIB_DIRECTORY = environmentDirectory;

  const endpoint = EndpointPath.satisfies({
    scopePath: ['home', 'room'],
    deviceName: 'light',
    endpointName: '',
  });

  try {
    const first = upsertEndpointBinding(
      {version: 0, bindings: []},
      EndpointBinding.satisfies({
        endpoint,
        provider: {namespace: 'first', name: 'provider'},
        metadata: {value: 1},
      }),
    );
    const replaced = upsertEndpointBinding(
      first,
      EndpointBinding.satisfies({
        endpoint,
        provider: {namespace: 'second', name: 'provider'},
        metadata: {value: 2},
      }),
    );

    expect(replaced.bindings).toHaveLength(1);
    expect(replaced.bindings[0]?.provider.namespace).toBe('second');

    await writeBindingFile(replaced);
    await expect(readBindingFile()).resolves.toEqual(replaced);

    const removed = removeEndpointBinding(replaced, endpoint);

    await writeBindingFile(removed);
    await expect(readBindingFile()).resolves.toEqual({
      version: 0,
      bindings: [],
    });
  } finally {
    if (originalEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = originalEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});
