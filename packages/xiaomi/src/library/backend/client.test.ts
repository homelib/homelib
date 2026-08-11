import {MiotSetPropertyRequest} from '../miot/index.js';

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

test('gets and sets properties', async () => {
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

    return jsonResponse([
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

    expect(requests).toEqual([
      expect.objectContaining({
        url: expect.stringMatching('/app/v2/miotspec/prop/get$'),
        body: {datasource: 1, params: [property]},
      }),
      expect.objectContaining({
        url: expect.stringMatching('/app/v2/miotspec/prop/set$'),
        body: {params: [{...property, value: true}]},
      }),
    ]);
    expect(readResults).toEqual([{...property, value: true, code: 0}]);
    expect(writeResults).toEqual([{...property, value: true, code: 0}]);
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
