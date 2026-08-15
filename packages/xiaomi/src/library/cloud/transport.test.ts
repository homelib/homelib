import {BackendClient} from '../backend/index.js';
import {MiotInvokeActionRequest} from '../miot/index.js';

import {MiotEndpointConnectionCloudTransport} from './transport.js';

test('invokes an action through the cloud transport', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: string | undefined;
  let requestBody: unknown;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as unknown;
    return new Response(JSON.stringify({code: 0, result: {code: 0}}));
  };

  try {
    const transport = new MiotEndpointConnectionCloudTransport(
      new BackendClient({uuid: 'test-uuid', accessToken: 'test-token'}),
    );
    const result = await transport.executeRequest(
      new MiotInvokeActionRequest({did: 'device-1', siid: 2, aiid: 1}, [
        {piid: 8, value: 10},
      ]),
    );

    expect(requestUrl).toMatch(/\/app\/v2\/miotspec\/action$/);
    expect(requestBody).toEqual({
      params: {did: 'device-1', siid: 2, aiid: 1, in: [10]},
    });
    expect(result).toEqual({code: 0});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
