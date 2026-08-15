import {
  MiotSpecAction,
  MiotSpecClient,
  type MiotSpecInstance,
  MiotSpecProperty,
} from './spec.js';

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

  globalThis.fetch = () => {
    fetchCallCount++;

    if (fetchCallCount === 1) {
      return new Promise<Response>(() => undefined);
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

    const second = client.getInstance(TEST_SPEC.type);

    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual(TEST_SPEC);
    expect(fetchCallCount).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    import.meta.jest.useRealTimers();
  }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

const TEST_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:cache-test:1',
  description: 'Cached Light',
  services: [],
};
