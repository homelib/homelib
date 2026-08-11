import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {$xiaomi, MiotProvider} from './provider.js';

test('rejects duplicate provider declarations', () => {
  $xiaomi('home');

  expect(() => $xiaomi('home')).toThrow('Duplicate provider: home.');
});

test('forgets the local session while preserving identity and configuration', async () => {
  const previousEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-miot-provider-test-'),
  );

  try {
    process.env.HOMELIB_DIRECTORY = environmentDirectory;

    const providerDirectory = join(environmentDirectory, 'providers', 'miot');
    const sessionPath = join(providerDirectory, 'home.json');
    const identityPath = join(providerDirectory, 'identity', 'home.json');
    const configurationPath = join(providerDirectory, 'config', 'home.json');

    await Promise.all([
      mkdir(join(providerDirectory, 'identity'), {recursive: true}),
      mkdir(join(providerDirectory, 'config'), {recursive: true}),
    ]);
    await Promise.all([
      writeFile(sessionPath, 'session'),
      writeFile(identityPath, 'identity'),
      writeFile(configurationPath, 'configuration'),
    ]);

    const provider = new MiotProvider('home');

    await provider.configuration.forgetAuthorization();
    await provider.configuration.forgetAuthorization();

    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(identityPath, 'utf8')).resolves.toBe('identity');
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe(
      'configuration',
    );
  } finally {
    if (previousEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = previousEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});
