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
    requests.push({url, headers: new Headers(init?.headers), body});

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
        share_home_list: [],
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
            owner: {userid: 456, nickname: 'Sharer'},
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
    expect(discovery.devices).toEqual([
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
    ]);
    expect(JSON.stringify(discovery)).not.toContain('must-not-leak');
    expect(JSON.stringify(discovery)).not.toContain('192.0.2.1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(result: unknown): Response {
  return new Response(JSON.stringify({code: 0, result}));
}
