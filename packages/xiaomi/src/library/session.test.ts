import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer, get} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {DEFAULT_CLOUD_SERVER} from './backend/index.js';
import {
  type OAuthSessionAuthorization,
  OAuthSessionMissingError,
  beginOAuthSessionAuthorization,
  loadValidOAuthSession,
  saveOAuthSession,
  startOAuthCallbackListener,
} from './session.js';

test('receives an OAuth callback and releases its port', async () => {
  const port = await reservePort();
  const redirectUrl = `http://homeassistant.local:${port}/api/webhook/test`;
  const listener = await startOAuthCallbackListener({
    expectedState: 'expected-state',
    redirectUrl,
    timeout: 1_000,
  });

  try {
    const invalidResponse = await requestCallback(
      redirectUrl,
      '?code=test-code&state=invalid-state',
    );

    expect(invalidResponse.status).toBe(400);

    const callback = listener.wait();
    const response = await requestCallback(
      redirectUrl,
      '?code=test-code&state=expected-state',
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain('close this tab');
    await expect(callback).resolves.toBe('test-code');
    await expectPortAvailable(port);
  } finally {
    await listener.close();
    await listener.wait().catch(() => undefined);
  }
});

test('closes an OAuth callback listener idempotently and releases its port', async () => {
  const port = await reservePort();
  const listener = await startOAuthCallbackListener({
    expectedState: 'expected-state',
    redirectUrl: `http://homeassistant.local:${port}/callback`,
    timeout: 1_000,
  });
  const callback = listener.wait();
  const firstClose = listener.close();
  const secondClose = listener.close();

  expect(secondClose).toBe(firstClose);
  await Promise.all([firstClose, secondClose]);

  await expect(callback).rejects.toThrow('OAuth callback listener closed.');
  await expectPortAvailable(port);
});

test('completes and persists an initial OAuth authorization', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));
  const sessionPath = join(directory, 'session.json');
  const uuidPath = join(directory, 'uuid.json');
  const port = await reservePort();
  const redirectUrl = `http://homeassistant.local:${port}/api/webhook/test`;
  let authorization: OAuthSessionAuthorization | undefined;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 0,
        result: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3_600,
        },
      }),
    );

  try {
    authorization = await beginOAuthSessionAuthorization({
      sessionPath,
      uuidPath,
      cloudServer: DEFAULT_CLOUD_SERVER,
      redirectUrl,
    });
    const authorizationUrl = new URL(authorization.url);
    const state = authorizationUrl.searchParams.get('state');

    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(redirectUrl);
    expect(state).not.toBeNull();

    const completion = authorization.wait();

    await requestCallback(
      redirectUrl,
      `?code=test-code&state=${encodeURIComponent(String(state))}`,
    );

    const session = await completion;

    expect(await loadValidOAuthSession(sessionPath)).toEqual(session);
    expect(JSON.parse(await readFile(uuidPath, 'utf8'))).toBe(session.uuid);
    await expectPortAvailable(port);
  } finally {
    await authorization?.cancel();
    await authorization?.wait().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(directory, {recursive: true, force: true});
  }
});

test('cancels a pending initial OAuth authorization and releases its port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));
  const sessionPath = join(directory, 'session.json');
  const port = await reservePort();
  let authorization: OAuthSessionAuthorization | undefined;

  try {
    authorization = await beginOAuthSessionAuthorization({
      sessionPath,
      uuidPath: join(directory, 'uuid.json'),
      cloudServer: DEFAULT_CLOUD_SERVER,
      redirectUrl: `http://homeassistant.local:${port}/callback`,
    });
    const completion = authorization.wait();

    await authorization.cancel();

    await expect(completion).rejects.toThrow('OAuth callback listener closed.');
    await expectPortAvailable(port);
    await expect(loadValidOAuthSession(sessionPath)).rejects.toBeInstanceOf(
      OAuthSessionMissingError,
    );
  } finally {
    await authorization?.cancel();
    await authorization?.wait().catch(() => undefined);
    await rm(directory, {recursive: true, force: true});
  }
});

test('commits an accepted OAuth code despite later cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));
  const sessionPath = join(directory, 'session.json');
  const port = await reservePort();
  const redirectUrl = `http://homeassistant.local:${port}/callback`;
  let authorization: OAuthSessionAuthorization | undefined;
  let markExchangeStarted: () => void = () => undefined;
  let releaseExchange: () => void = () => undefined;
  const exchangeStarted = new Promise<void>(resolve => {
    markExchangeStarted = resolve;
  });
  const exchangeReleased = new Promise<void>(resolve => {
    releaseExchange = resolve;
  });

  globalThis.fetch = async () => {
    markExchangeStarted();
    await exchangeReleased;

    return new Response(
      JSON.stringify({
        code: 0,
        result: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3_600,
        },
      }),
    );
  };

  try {
    authorization = await beginOAuthSessionAuthorization({
      sessionPath,
      uuidPath: join(directory, 'uuid.json'),
      cloudServer: DEFAULT_CLOUD_SERVER,
      redirectUrl,
    });
    const state = new URL(authorization.url).searchParams.get('state');
    const completion = authorization.wait();
    const callbackResponse = requestCallback(
      redirectUrl,
      `?code=test-code&state=${encodeURIComponent(String(state))}`,
    );

    await exchangeStarted;
    await authorization.cancel();
    await expectPortAvailable(port);
    releaseExchange();

    const session = await completion;

    await expect(callbackResponse).resolves.toMatchObject({status: 200});
    expect(await loadValidOAuthSession(sessionPath)).toEqual(session);
  } finally {
    releaseExchange();
    await authorization?.cancel();
    await authorization?.wait().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(directory, {recursive: true, force: true});
  }
});

test('shares one UUID across concurrent initial authorizations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));
  const uuidPath = join(directory, 'uuid.json');
  const firstPort = await reservePort();
  let secondPort = await reservePort();

  while (secondPort === firstPort) {
    secondPort = await reservePort();
  }

  const authorizations: OAuthSessionAuthorization[] = [];

  try {
    authorizations.push(
      ...(await Promise.all([
        beginOAuthSessionAuthorization({
          sessionPath: join(directory, 'first-session.json'),
          uuidPath,
          cloudServer: DEFAULT_CLOUD_SERVER,
          redirectUrl: `http://homeassistant.local:${firstPort}/first`,
        }),
        beginOAuthSessionAuthorization({
          sessionPath: join(directory, 'second-session.json'),
          uuidPath,
          cloudServer: DEFAULT_CLOUD_SERVER,
          redirectUrl: `http://homeassistant.local:${secondPort}/second`,
        }),
      ])),
    );

    const deviceIds = authorizations.map(authorization =>
      new URL(authorization.url).searchParams.get('device_id'),
    );
    const uuid = JSON.parse(await readFile(uuidPath, 'utf8')) as string;

    expect(deviceIds[0]).toBe(`ha.${uuid}`);
    expect(deviceIds[1]).toBe(`ha.${uuid}`);
  } finally {
    await Promise.all(
      authorizations.map(authorization => authorization.cancel()),
    );
    await Promise.allSettled(
      authorizations.map(authorization => authorization.wait()),
    );
    await rm(directory, {recursive: true, force: true});
  }
});

test('reports a missing OAuth session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));

  try {
    await expect(
      loadValidOAuthSession(join(directory, 'missing.json')),
    ).rejects.toBeInstanceOf(OAuthSessionMissingError);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('shares one refresh across concurrent expired-session loads', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-session-'));
  const sessionPath = join(directory, 'session.json');
  let requestCount = 0;
  let markRequestStarted: () => void = () => undefined;
  let releaseRequest: () => void = () => undefined;
  const requestStarted = new Promise<void>(resolve => {
    markRequestStarted = resolve;
  });
  const requestReleased = new Promise<void>(resolve => {
    releaseRequest = resolve;
  });

  globalThis.fetch = async () => {
    requestCount++;
    markRequestStarted();
    await requestReleased;

    return new Response(
      JSON.stringify({
        code: 0,
        result: {
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 3_600,
        },
      }),
    );
  };

  try {
    await saveExpiredOAuthSession(sessionPath);

    const firstSession = loadValidOAuthSession(sessionPath);
    const secondSession = loadValidOAuthSession(sessionPath);

    await requestStarted;
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    expect(requestCount).toBe(1);
    releaseRequest();

    const [first, second] = await Promise.all([firstSession, secondSession]);

    expect(first).toBe(second);
    expect(first.token.accessToken).toBe('refreshed-access-token');
    expect(requestCount).toBe(1);
  } finally {
    releaseRequest();
    globalThis.fetch = originalFetch;
    await rm(directory, {recursive: true, force: true});
  }
});

async function reservePort(): Promise<number> {
  const server = createServer();

  await listen(server, 0);

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new TypeError('Expected a TCP server address.');
  }

  await close(server);
  return address.port;
}

async function expectPortAvailable(port: number): Promise<void> {
  const server = createServer();

  try {
    await listen(server, port);
  } finally {
    await close(server);
  }
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function requestCallback(
  redirectUrlValue: string,
  search: string,
): Promise<{readonly status: number; readonly body: string}> {
  const url = new URL(redirectUrlValue);

  url.hostname = '127.0.0.1';
  url.search = search;

  return new Promise((resolve, reject) => {
    const request = get(url, response => {
      const chunks: string[] = [];

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({status: response.statusCode ?? 0, body: chunks.join('')});
      });
    });

    request.on('error', reject);
  });
}

function saveExpiredOAuthSession(path: string): Promise<void> {
  return saveOAuthSession(path, {
    uuid: '0123456789abcdef0123456789abcdef',
    cloudServer: DEFAULT_CLOUD_SERVER,
    redirectUrl: 'http://homeassistant.local:8123/api/webhook/test',
    expiresAt: new Date(0).toISOString(),
    token: {
      accessToken: 'expired-access-token',
      refreshToken: 'test-refresh-token',
      expiresIn: 3_600,
    },
  });
}
