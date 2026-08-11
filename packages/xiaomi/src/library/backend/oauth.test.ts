import {OAUTH2_CLIENT_ID} from './constants.js';
import {OAUTH2_AUTH_URL, OAUTH_REDIRECT_URL, OAuthClient} from './oauth.js';

test('creates an OAuth authorization', () => {
  const oauthClient = new OAuthClient('test-uuid');
  const authorization = oauthClient.createAuthorization();
  const url = new URL(authorization.url);

  expect(`${url.origin}${url.pathname}`).toBe(OAUTH2_AUTH_URL);
  expect(url.searchParams.get('redirect_uri')).toBe(OAUTH_REDIRECT_URL);
  expect(url.searchParams.get('client_id')).toBe(OAUTH2_CLIENT_ID);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('device_id')).toBe('ha.test-uuid');
  expect(url.searchParams.get('state')).toBe(authorization.state);
  expect(oauthClient.createAuthorization().state).toBe(authorization.state);
  expect(url.searchParams.get('skip_confirm')).toBe('false');
});

test('exchanges an authorization code', async () => {
  const originalFetch = globalThis.fetch;
  let request: string | URL | Request | undefined;

  globalThis.fetch = async input => {
    request = input;

    return new Response(
      JSON.stringify({
        code: 0,
        result: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          mac_key: 'test-mac-key',
        },
      }),
    );
  };

  try {
    const token = await new OAuthClient('test-uuid').exchangeCode('test-code');

    expect(request).toBeDefined();

    const url = new URL(String(request));
    const data = url.searchParams.get('data');

    expect(data).toContain(`"client_id":${OAUTH2_CLIENT_ID}`);
    expect(data).toContain('"code":"test-code"');
    expect(token).toEqual({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresIn: 3600,
      macKey: 'test-mac-key',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshes an OAuth token', async () => {
  const originalFetch = globalThis.fetch;
  let request: string | URL | Request | undefined;

  globalThis.fetch = async input => {
    request = input;

    return new Response(
      JSON.stringify({
        code: 0,
        result: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        },
      }),
    );
  };

  try {
    await new OAuthClient('test-uuid').refreshToken('test-refresh-token');

    expect(request).toBeDefined();

    const url = new URL(String(request));
    const data = url.searchParams.get('data');

    expect(data).toContain('"refresh_token":"test-refresh-token"');
    expect(data).not.toContain('"device_id"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports an OAuth error response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: -6,
        result: {
          error: 96013,
          error_description: 'invalid authorization code',
        },
      }),
    );

  try {
    await expect(
      new OAuthClient('test-uuid').exchangeCode('invalid-code'),
    ).rejects.toThrow(
      'OAuth token request failed: -6/96013 (invalid authorization code).',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('passes caller cancellation to the token request', async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | undefined;

  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;

      if (requestSignal === undefined) {
        reject(new Error('Missing request signal.'));
      } else if (requestSignal.aborted) {
        reject(requestSignal.reason);
      } else {
        requestSignal.addEventListener(
          'abort',
          () => {
            reject(requestSignal?.reason);
          },
          {once: true},
        );
      }
    });

  try {
    const controller = new AbortController();
    const reason = new Error('OAuth cancelled.');
    const token = new OAuthClient('test-uuid').exchangeCode(
      'test-code',
      OAUTH_REDIRECT_URL,
      controller.signal,
    );

    controller.abort(reason);

    await expect(token).rejects.toBe(reason);
    expect(requestSignal?.aborted).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
