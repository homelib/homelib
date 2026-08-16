import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import * as x from 'x-value';

const MIOT_SPEC_INSTANCE_URL = 'https://miot-spec.org/miot-spec-v2/instance';
const MIOT_SPEC_REQUEST_TIMEOUT = 30_000;

export class MiotSpecClient {
  private readonly instancePromiseMap = new Map<
    string,
    Promise<MiotSpecInstance>
  >();

  private readonly refreshPromiseMap = new Map<
    string,
    Promise<MiotSpecInstance>
  >();

  constructor(private readonly options: MiotSpecClientOptions = {}) {}

  getInstance(urn: string): Promise<MiotSpecInstance> {
    const cachedInstancePromise = this.instancePromiseMap.get(urn);

    if (cachedInstancePromise !== undefined) {
      return cachedInstancePromise;
    }

    const instancePromise = this.loadInstance(urn);

    this.instancePromiseMap.set(urn, instancePromise);
    void instancePromise.catch(() => {
      if (this.instancePromiseMap.get(urn) === instancePromise) {
        this.instancePromiseMap.delete(urn);
      }
    });

    return instancePromise;
  }

  /**
   * Reloads an instance from the public spec service, bypassing both caches.
   *
   * A successful refresh atomically replaces the persistent entry before it
   * becomes the current in-memory value. A failed refresh leaves the current
   * in-memory and persistent cache available for ordinary reads.
   */
  refreshInstance(urn: string): Promise<MiotSpecInstance> {
    const activeRefreshPromise = this.refreshPromiseMap.get(urn);

    if (activeRefreshPromise !== undefined) {
      return activeRefreshPromise;
    }

    const refreshPromise = this.loadFreshInstance(urn);

    this.refreshPromiseMap.set(urn, refreshPromise);
    void refreshPromise.then(
      () => {
        if (this.refreshPromiseMap.get(urn) === refreshPromise) {
          this.refreshPromiseMap.delete(urn);
          this.instancePromiseMap.set(urn, refreshPromise);
        }
      },
      () => {
        if (this.refreshPromiseMap.get(urn) === refreshPromise) {
          this.refreshPromiseMap.delete(urn);
        }
      },
    );

    return refreshPromise;
  }

  private loadInstance(urn: string): Promise<MiotSpecInstance> {
    return this.options.cacheDirectory === undefined
      ? this.requestInstanceWithTimeout(urn)
      : this.loadCachedInstance(urn, this.options.cacheDirectory);
  }

  private async loadCachedInstance(
    urn: string,
    cacheDirectory: string,
  ): Promise<MiotSpecInstance> {
    const path = getMiotSpecCachePath(cacheDirectory, urn);
    const cachedInstance = await readCachedMiotSpecInstance(path, urn);

    if (cachedInstance !== undefined) {
      return cachedInstance;
    }

    const instance = await this.requestInstanceWithTimeout(urn);

    await writeCachedMiotSpecInstance(path, instance);
    return instance;
  }

  private async loadFreshInstance(urn: string): Promise<MiotSpecInstance> {
    const instance = await this.requestInstanceWithTimeout(urn);
    const {cacheDirectory} = this.options;

    if (cacheDirectory !== undefined) {
      await writeCachedMiotSpecInstance(
        getMiotSpecCachePath(cacheDirectory, urn),
        instance,
      );
    }

    return instance;
  }

  private requestInstanceWithTimeout(urn: string): Promise<MiotSpecInstance> {
    return withRequestTimeout(signal => this.requestInstance(urn, signal));
  }

  private async requestInstance(
    urn: string,
    signal: AbortSignal,
  ): Promise<MiotSpecInstance> {
    const url = new URL(MIOT_SPEC_INSTANCE_URL);
    url.searchParams.set('type', urn);
    const response = await fetch(url, {signal});

    if (!response.ok) {
      throw new Error(`Failed to get MIoT spec instance: ${response.status}.`);
    }

    const instance = MiotSpecInstance.satisfies(await response.json());

    if (instance.type !== urn) {
      throw new Error('MIoT spec instance type does not match the request.');
    }

    return instance;
  }
}

export type MiotSpecClientOptions = {
  readonly cacheDirectory?: string;
};

export const MiotSpecValueRange = x.tuple([x.number, x.number, x.number]);

export type MiotSpecValueRange = x.TypeOf<typeof MiotSpecValueRange>;

export const MiotSpecValueListEntry = x.object({
  value: x.number,
  description: x.string,
});

export type MiotSpecValueListEntry = x.TypeOf<typeof MiotSpecValueListEntry>;

export const MiotSpecValueList = x.array(MiotSpecValueListEntry);

export type MiotSpecValueList = x.TypeOf<typeof MiotSpecValueList>;

export const MiotSpecProperty = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  format: x.string,
  access: x.array(x.string),
  unit: x.string.optional(),
  'value-range': MiotSpecValueRange.optional(),
  'value-list': MiotSpecValueList.optional(),
});

export type MiotSpecProperty = x.TypeOf<typeof MiotSpecProperty>;

export const MiotSpecAction = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  in: x.array(x.number),
  out: x.array(x.number),
});

export type MiotSpecAction = x.TypeOf<typeof MiotSpecAction>;

export const MiotSpecEvent = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  arguments: x.array(x.number),
});

export type MiotSpecEvent = x.TypeOf<typeof MiotSpecEvent>;

export const MiotSpecService = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  properties: x.array(MiotSpecProperty).optional(),
  actions: x.array(MiotSpecAction).optional(),
  events: x.array(MiotSpecEvent).optional(),
});

export type MiotSpecService = x.TypeOf<typeof MiotSpecService>;

export const MiotSpecInstance = x.object({
  type: x.string,
  description: x.string,
  services: x.array(MiotSpecService),
});

export type MiotSpecInstance = x.TypeOf<typeof MiotSpecInstance>;

function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('MIoT spec request timed out.'));
      controller.abort();
    }, MIOT_SPEC_REQUEST_TIMEOUT);
  });

  return Promise.race([request(controller.signal), timeoutPromise]).finally(
    () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    },
  );
}

async function readCachedMiotSpecInstance(
  path: string,
  urn: string,
): Promise<MiotSpecInstance | undefined> {
  let source: string;

  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  try {
    const instance = MiotSpecInstance.satisfies(JSON.parse(source) as unknown);

    return instance.type === urn ? instance : undefined;
  } catch {
    return undefined;
  }
}

async function writeCachedMiotSpecInstance(
  path: string,
  instance: MiotSpecInstance,
): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;

  await mkdir(dirname(path), {recursive: true, mode: 0o700});

  try {
    const handle = await open(temporaryPath, 'wx', 0o600);

    try {
      await handle.writeFile(`${JSON.stringify(instance, undefined, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporaryPath, {force: true});
  }
}

async function syncDirectory(path: string): Promise<void> {
  // Node does not expose POSIX directory fsync semantics on Windows.
  if (process.platform === 'win32') {
    return;
  }

  const handle = await open(path, 'r');

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function getMiotSpecCachePath(cacheDirectory: string, urn: string): string {
  const key = createHash('sha256').update(urn).digest('hex');

  return join(cacheDirectory, `${key}.json`);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
