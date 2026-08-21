import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {createPrivateJsonFile, writePrivateJsonFile} from '../storage.js';

test('atomically writes a private JSON file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-storage-'));
  const path = join(directory, 'nested', 'session.json');

  try {
    await writePrivateJsonFile(path, {token: 'secret'});

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({token: 'secret'});
    expect(await readdir(join(directory, 'nested'))).toEqual(['session.json']);

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, 'nested'))).mode & 0o777).toBe(0o700);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('preserves the previous file when serialization fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-storage-'));
  const path = join(directory, 'session.json');
  const circular: {self?: unknown} = {};

  circular.self = circular;

  try {
    await writePrivateJsonFile(path, {version: 1});
    await expect(writePrivateJsonFile(path, circular)).rejects.toThrow();

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({version: 1});
    expect(await readdir(directory)).toEqual(['session.json']);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('atomically creates only one private JSON file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-storage-'));
  const path = join(directory, 'identity.json');

  try {
    const results = await Promise.all(
      Array.from({length: 8}, (_value, index) =>
        createPrivateJsonFile(path, {index}),
      ),
    );
    const value = JSON.parse(await readFile(path, 'utf8')) as {index: number};

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(value.index).toBe(results.indexOf(true));
    expect(await readdir(directory)).toEqual(['identity.json']);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
