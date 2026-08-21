import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  MiotSpecAction,
  MiotSpecClient,
  type MiotSpecInstance,
  MiotSpecProperty,
} from '../../miot/spec.js';

test('preserves typed action input and output property identifiers', () => {
  const action = MiotSpecAction.satisfies({
    iid: 1,
    type: 'urn:miot-spec-v2:action:pet-food-out:0000282B:test:1',
    description: 'Pet Food Out',
    in: [8],
    out: [9],
  });

  expect(action.in).toEqual([8]);
  expect(action.out).toEqual([9]);
});

test('preserves a property unit and value range', () => {
  const property = MiotSpecProperty.satisfies({
    iid: 2,
    type: 'urn:miot-spec-v2:property:brightness:0000000D:test:1',
    description: 'Brightness',
    format: 'uint8',
    access: ['read', 'write', 'notify'],
    unit: 'percentage',
    'value-range': [1, 100, 1],
  });

  expect(property.unit).toBe('percentage');
  expect(property['value-range']).toEqual([1, 100, 1]);
});

test('preserves typed property value-list entries', () => {
  const property = MiotSpecProperty.satisfies({
    iid: 3,
    type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
    description: 'Mode',
    format: 'uint8',
    access: ['read', 'write', 'notify'],
    'value-list': [
      {value: 0, description: 'Straight Wind'},
      {value: 1, description: 'Natural Wind'},
    ],
  });

  expect(property['value-list']).toEqual([
    {value: 0, description: 'Straight Wind'},
    {value: 1, description: 'Natural Wind'},
  ]);
});

test('rejects an invalid property value-list entry', () => {
  expect(() =>
    MiotSpecProperty.satisfies({
      iid: 3,
      type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
      description: 'Mode',
      format: 'uint8',
      access: ['read', 'write'],
      'value-list': [{value: 0, description: 0}],
    }),
  ).toThrow();
});

test('rejects a value range with the wrong tuple length', () => {
  expect(() =>
    MiotSpecProperty.satisfies({
      iid: 2,
      type: 'urn:miot-spec-v2:property:brightness:0000000D:test:1',
      description: 'Brightness',
      format: 'uint8',
      access: ['read', 'write'],
      unit: 'percentage',
      'value-range': [1, 100],
    }),
  ).toThrow();
});

test('shares in-flight MIoT spec requests and caches successful results', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let resolveFetch: ((response: Response) => void) | undefined;

  globalThis.fetch = () => {
    fetchCallCount++;

    return new Promise(resolve => {
      resolveFetch = resolve;
    });
  };

  try {
    const client = new MiotSpecClient();
    const first = client.getInstance(TEST_SPEC.type);
    const second = client.getInstance(TEST_SPEC.type);

    expect(second).toBe(first);
    expect(fetchCallCount).toBe(1);

    if (resolveFetch === undefined) {
      throw new Error('MIoT spec request did not start.');
    }

    resolveFetch(jsonResponse(TEST_SPEC));
    await expect(first).resolves.toEqual(TEST_SPEC);

    expect(client.getInstance(TEST_SPEC.type)).toBe(first);
    expect(fetchCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a rejected MIoT spec request', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount++;

    return fetchCallCount === 1
      ? new Response(undefined, {status: 503})
      : jsonResponse(TEST_SPEC);
  };

  try {
    const client = new MiotSpecClient();

    await expect(client.getInstance(TEST_SPEC.type)).rejects.toThrow(
      'Failed to get MIoT spec instance: 503.',
    );
    await expect(client.getInstance(TEST_SPEC.type)).resolves.toEqual(
      TEST_SPEC,
    );
    expect(fetchCallCount).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a timed-out MIoT spec request', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let timedOutSignal: AbortSignal | null | undefined;

  globalThis.fetch = (_input, init) => {
    fetchCallCount++;

    if (fetchCallCount === 1) {
      timedOutSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        timedOutSignal?.addEventListener('abort', () => {
          reject(timedOutSignal?.reason);
        });
      });
    }

    return Promise.resolve(jsonResponse(TEST_SPEC));
  };
  import.meta.jest.useFakeTimers();

  try {
    const client = new MiotSpecClient();
    const first = client.getInstance(TEST_SPEC.type);
    const rejection = expect(first).rejects.toThrow(
      'MIoT spec request timed out.',
    );

    await import.meta.jest.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(timedOutSignal?.aborted).toBe(true);

    const second = client.getInstance(TEST_SPEC.type);

    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual(TEST_SPEC);
    expect(fetchCallCount).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    import.meta.jest.useRealTimers();
  }
});

test('force refresh bypasses both caches and becomes the current value', async () => {
  const originalFetch = globalThis.fetch;
  const cacheDirectory = await createCacheDirectory();
  const staleSpec = {...TEST_SPEC, description: 'Stale cached light'};
  const cachePath = getCachePath(cacheDirectory);
  let fetchCallCount = 0;

  await writeFile(cachePath, JSON.stringify(staleSpec));
  globalThis.fetch = async () => {
    fetchCallCount++;
    return jsonResponse(TEST_SPEC);
  };

  try {
    const client = new MiotSpecClient({cacheDirectory});
    const cached = client.getInstance(TEST_SPEC.type);

    await expect(cached).resolves.toEqual(staleSpec);
    expect(fetchCallCount).toBe(0);

    const refreshed = client.refreshInstance(TEST_SPEC.type);

    expect(client.refreshInstance(TEST_SPEC.type)).toBe(refreshed);
    expect(client.getInstance(TEST_SPEC.type)).toBe(cached);
    await expect(refreshed).resolves.toEqual(TEST_SPEC);
    expect(client.getInstance(TEST_SPEC.type)).toBe(refreshed);
    expect(fetchCallCount).toBe(1);
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual(TEST_SPEC);

    await expect(
      new MiotSpecClient({cacheDirectory}).getInstance(TEST_SPEC.type),
    ).resolves.toEqual(TEST_SPEC);
    expect(fetchCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cacheDirectory, {recursive: true, force: true});
  }
});

test('failed force refresh preserves the current caches', async () => {
  const originalFetch = globalThis.fetch;
  const cacheDirectory = await createCacheDirectory();
  const cachePath = getCachePath(cacheDirectory);

  await writeFile(cachePath, JSON.stringify(TEST_SPEC));
  globalThis.fetch = async () => new Response(undefined, {status: 503});

  try {
    const client = new MiotSpecClient({cacheDirectory});
    const cached = client.getInstance(TEST_SPEC.type);

    await expect(cached).resolves.toEqual(TEST_SPEC);
    await expect(client.refreshInstance(TEST_SPEC.type)).rejects.toThrow(
      'Failed to get MIoT spec instance: 503.',
    );
    expect(client.getInstance(TEST_SPEC.type)).toBe(cached);
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual(TEST_SPEC);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cacheDirectory, {recursive: true, force: true});
  }
});

test('persists MIoT specs and reuses them across client instances', async () => {
  const originalFetch = globalThis.fetch;
  const cacheDirectory = await createCacheDirectory();
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount++;
    return jsonResponse(TEST_SPEC);
  };

  try {
    const firstClient = new MiotSpecClient({cacheDirectory});
    const first = firstClient.getInstance(TEST_SPEC.type);

    expect(firstClient.getInstance(TEST_SPEC.type)).toBe(first);
    await expect(first).resolves.toEqual(TEST_SPEC);
    expect(
      JSON.parse(await readFile(getCachePath(cacheDirectory), 'utf8')),
    ).toEqual(TEST_SPEC);

    globalThis.fetch = async () => {
      fetchCallCount++;
      throw new Error('Unexpected MIoT spec request.');
    };

    await expect(
      new MiotSpecClient({cacheDirectory}).getInstance(TEST_SPEC.type),
    ).resolves.toEqual(TEST_SPEC);
    expect(fetchCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cacheDirectory, {recursive: true, force: true});
  }
});

test.each(['malformed', 'wrong-type'])(
  'replaces a %s MIoT spec cache only after a successful request',
  async description => {
    const originalFetch = globalThis.fetch;
    const cacheDirectory = await createCacheDirectory();
    const cachePath = getCachePath(cacheDirectory);
    const originalSource =
      description === 'malformed'
        ? 'not json'
        : JSON.stringify({...TEST_SPEC, type: `${TEST_SPEC.type}:wrong`});
    let fetchCallCount = 0;

    await writeFile(cachePath, originalSource);
    globalThis.fetch = async () => {
      fetchCallCount++;

      return fetchCallCount === 1
        ? new Response(undefined, {status: 503})
        : jsonResponse(TEST_SPEC);
    };

    try {
      const client = new MiotSpecClient({cacheDirectory});

      await expect(client.getInstance(TEST_SPEC.type)).rejects.toThrow(
        'Failed to get MIoT spec instance: 503.',
      );
      await expect(readFile(cachePath, 'utf8')).resolves.toBe(originalSource);

      await expect(client.getInstance(TEST_SPEC.type)).resolves.toEqual(
        TEST_SPEC,
      );
      expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual(TEST_SPEC);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  },
);

test('rejects a persistent cache write failure and retries it', async () => {
  const originalFetch = globalThis.fetch;
  const cacheDirectory = await createCacheDirectory();
  const movedCacheDirectory = `${cacheDirectory}-moved`;
  const cachePath = getCachePath(cacheDirectory);
  const originalSource = 'not json';
  let resolveFetch: ((response: Response) => void) | undefined;
  let notifyFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>(resolve => {
    notifyFetchStarted = resolve;
  });

  await writeFile(cachePath, originalSource);
  globalThis.fetch = () => {
    notifyFetchStarted?.();

    return new Promise(resolve => {
      resolveFetch = resolve;
    });
  };

  try {
    const client = new MiotSpecClient({cacheDirectory});
    const first = client.getInstance(TEST_SPEC.type);

    await fetchStarted;
    await rename(cacheDirectory, movedCacheDirectory);
    await writeFile(cacheDirectory, 'not a directory');

    if (resolveFetch === undefined) {
      throw new Error('MIoT spec request did not start.');
    }

    resolveFetch(jsonResponse(TEST_SPEC));
    await expect(first).rejects.toThrow();
    await expect(
      readFile(getCachePath(movedCacheDirectory), 'utf8'),
    ).resolves.toBe(originalSource);

    await rm(cacheDirectory, {force: true});
    await rename(movedCacheDirectory, cacheDirectory);
    globalThis.fetch = async () => jsonResponse(TEST_SPEC);

    await expect(client.getInstance(TEST_SPEC.type)).resolves.toEqual(
      TEST_SPEC,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cacheDirectory, {recursive: true, force: true});
    await rm(movedCacheDirectory, {recursive: true, force: true});
  }
});

test('rejects a requested MIoT spec with a different type', async () => {
  const originalFetch = globalThis.fetch;
  const cacheDirectory = await createCacheDirectory();

  globalThis.fetch = async () =>
    jsonResponse({...TEST_SPEC, type: `${TEST_SPEC.type}:wrong`});

  try {
    const client = new MiotSpecClient({cacheDirectory});

    await expect(client.getInstance(TEST_SPEC.type)).rejects.toThrow(
      'MIoT spec instance type does not match the request.',
    );
    await expect(
      readFile(getCachePath(cacheDirectory), 'utf8'),
    ).rejects.toMatchObject({code: 'ENOENT'});
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cacheDirectory, {recursive: true, force: true});
  }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

function createCacheDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'homelib-miot-spec-test-'));
}

function getCachePath(cacheDirectory: string): string {
  const key = createHash('sha256').update(TEST_SPEC.type).digest('hex');

  return join(cacheDirectory, `${key}.json`);
}

const TEST_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:cache-test:1',
  description: 'Cached Light',
  services: [],
};
