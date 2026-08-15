import {
  MiotInvokeActionRequest,
  MiotSetPropertyRequest,
} from '../miot/index.js';

import {BackendClient} from './client.js';

test('discovers owned and separately shared devices', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    readonly url: string;
    readonly headers: Headers;
    readonly body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url,
      headers: new Headers(init?.headers),
      body,
    });

    if (url.endsWith('/app/v2/homeroom/gethome')) {
      return jsonResponse({
        homelist: [
          {
            id: 'home-1',
            name: 'Home',
            uid: 123,
            dids: ['device-1'],
            roomlist: [{id: 'room-1', name: 'Living Room', dids: ['device-1']}],
          },
        ],
        share_home_list: [
          {
            id: 'home-1',
            name: 'Shared Home',
            dids: ['device-3'],
            roomlist: [],
          },
        ],
      });
    } else if (url.endsWith('/app/v2/home/device_list_page')) {
      const dids = body.dids as string[];

      if (dids.length > 0) {
        return jsonResponse({
          list: [
            {
              did: 'device-1',
              name: 'Light',
              model: 'example.light.v1',
              spec_type: 'urn:miot-spec-v2:device:light:0000A001:1',
              isOnline: true,
              token: 'must-not-leak',
              local_ip: '192.0.2.1',
            },
            {
              did: 'device-3',
              name: 'Shared-home Light',
              model: 'example.light.v3',
              spec_type: 'urn:miot-spec-v2:device:light:0000A001:3',
            },
          ],
          has_more: false,
        });
      }

      return jsonResponse({
        list: [
          {
            did: 'device-2',
            name: 'Shared Light',
            model: 'example.light.v2',
            spec_type: 'urn:miot-spec-v2:device:light:0000A001:2',
            owner: {userid: 'home-1', nickname: 'Sharer'},
          },
        ],
        has_more: false,
      });
    }

    throw new Error(`Unexpected cloud request: ${url}.`);
  };

  try {
    const discovery = await new BackendClient({
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
    }).discoverDevices();

    expect(requests).toHaveLength(3);
    expect(requests[0]?.headers.get('authorization')).toBe(
      'Bearertest-access-token',
    );
    expect(discovery.userId).toBe('123');
    expect(discovery.homes).toHaveLength(3);
    expect(discovery.homes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'home-1', source: 'owned'}),
        expect.objectContaining({id: 'home-1', source: 'shared-home'}),
        expect.objectContaining({id: 'home-1', source: 'shared-device'}),
      ]),
    );
    expect(discovery.devices).toHaveLength(3);
    expect(discovery.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          did: 'device-1',
          homeName: 'Home',
          roomName: 'Living Room',
          source: 'owned',
        }),
        expect.objectContaining({
          did: 'device-2',
          homeName: 'Sharer',
          source: 'shared-device',
        }),
        expect.objectContaining({
          did: 'device-3',
          homeName: 'Shared Home',
          source: 'shared-home',
        }),
      ]),
    );
    expect(JSON.stringify(discovery)).not.toContain('must-not-leak');
    expect(JSON.stringify(discovery)).not.toContain('192.0.2.1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gets and sets properties and invokes actions', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    readonly url: string;
    readonly body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });

    return url.endsWith('/app/v2/miotspec/action')
      ? jsonResponse({code: 0})
      : jsonResponse([
          {did: 'device-1', siid: 2, piid: 1, value: true, code: 0},
        ]);
  };

  try {
    const client = new BackendClient({
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
    });
    const property = {did: 'device-1', siid: 2, piid: 1};

    const readResults = await client.getProperties([property]);
    const writeResults = await client.setProperties([
      new MiotSetPropertyRequest(property, true),
    ]);
    const actionResult = await client.invokeAction(
      new MiotInvokeActionRequest({did: 'device-1', siid: 2, aiid: 1}, [
        {piid: 8, value: 10},
        {piid: 9, value: 20},
      ]),
    );

    expect(requests).toEqual([
      expect.objectContaining({
        url: expect.stringMatching('/app/v2/miotspec/prop/get$'),
        body: {datasource: 1, params: [property]},
      }),
      expect.objectContaining({
        url: expect.stringMatching('/app/v2/miotspec/prop/set$'),
        body: {params: [{...property, value: true}]},
      }),
      expect.objectContaining({
        url: expect.stringMatching('/app/v2/miotspec/action$'),
        body: {
          params: {did: 'device-1', siid: 2, aiid: 1, in: [10, 20]},
        },
      }),
    ]);
    expect(readResults).toEqual([{...property, value: true, code: 0}]);
    expect(writeResults).toEqual([{...property, value: true, code: 0}]);
    expect(actionResult).toEqual({code: 0});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requests a central certificate with a base64 encoded CSR', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({cert: 'signed-certificate'});
  };

  try {
    const client = new BackendClient({
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
    });

    await expect(
      client.getCentralCertificate('certificate-request'),
    ).resolves.toBe('signed-certificate');
    expect(requestBody).toEqual({
      csr: Buffer.from('certificate-request').toString('base64'),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an invalid central certificate response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => jsonResponse({});

  try {
    await expect(
      new BackendClient({
        uuid: 'test-uuid',
        accessToken: 'test-access-token',
      }).getCentralCertificate('certificate-request'),
    ).rejects.toThrow('Cloud API returned an invalid central certificate.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gets a device online state with an exact device query', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);

    return jsonResponse({
      list: [{did: 'device-1', isOnline: false}],
      has_more: false,
    });
  };

  try {
    const online = await new BackendClient({
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
    }).getDeviceOnline('device-1');

    expect(online).toBe(false);
    expect(requests).toEqual([
      {
        limit: 200,
        get_split_device: true,
        get_third_device: true,
        dids: ['device-1'],
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.each([
  {
    result: {list: [], has_more: false},
    error: 'Cloud device was not returned: device-1.',
  },
  {
    result: {list: [{did: 'device-1'}], has_more: false},
    error: 'Cloud device device-1 returned invalid online state.',
  },
])('rejects an unavailable device online state', async ({result, error}) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => jsonResponse(result);

  try {
    await expect(
      new BackendClient({
        uuid: 'test-uuid',
        accessToken: 'test-access-token',
      }).getDeviceOnline('device-1'),
    ).rejects.toThrow(error);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an ambiguous paginated home id', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async input => {
    const url = String(input);

    if (url.endsWith('/app/v2/homeroom/gethome')) {
      return jsonResponse({
        homelist: [{id: 'same-id', name: 'Owned', roomlist: []}],
        share_home_list: [{id: 'same-id', name: 'Shared', roomlist: []}],
        has_more: true,
        max_id: 'next-page',
      });
    } else if (url.endsWith('/app/v2/homeroom/get_dev_room_page')) {
      return jsonResponse({
        info: [{id: 'same-id', dids: []}],
        has_more: false,
      });
    }

    throw new Error(`Unexpected cloud request: ${url}.`);
  };

  try {
    await expect(
      new BackendClient({
        uuid: 'test-uuid',
        accessToken: 'test-access-token',
      }).discoverDevices(),
    ).rejects.toThrow(
      'Cloud home pagination returned ambiguous home id: same-id.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(result: unknown): Response {
  return new Response(JSON.stringify({code: 0, result}));
}
