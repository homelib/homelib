import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {readBindingFile} from './binding.js';

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
