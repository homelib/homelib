import {randomUUID} from 'node:crypto';
import {chmod, link, mkdir, open, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';

export async function writePrivateJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const source = serializeJson(value);

  await preparePrivateDirectory(directory);

  try {
    await writePrivateFile(temporaryPath, source);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, {force: true});
  }
}

export async function createPrivateJsonFile(
  path: string,
  value: unknown,
): Promise<boolean> {
  const directory = dirname(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const source = serializeJson(value);

  await preparePrivateDirectory(directory);

  try {
    await writePrivateFile(temporaryPath, source);

    try {
      await link(temporaryPath, path);
      return true;
    } catch (error) {
      if (isFileExistsError(error)) {
        return false;
      }

      throw error;
    }
  } finally {
    await rm(temporaryPath, {force: true});
  }
}

function serializeJson(value: unknown): string {
  const source = JSON.stringify(value, undefined, 2);

  if (source === undefined) {
    throw new TypeError('Private JSON file value is not serializable.');
  }

  return source;
}

async function preparePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
}

async function writePrivateFile(path: string, source: string): Promise<void> {
  const file = await open(path, 'wx', 0o600);

  try {
    await file.writeFile(source);
    await file.sync();
  } finally {
    await file.close();
  }
}

function isFileExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'EEXIST';
}
