import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {type Server, createServer} from 'node:http';

import * as x from 'x-value';

import {
  CLOUD_SERVERS,
  type CloudServer,
  OAUTH_REDIRECT_URL,
  OAuthClient,
  type OAuthToken,
} from './backend/index.js';
import {createPrivateJsonFile, writePrivateJsonFile} from './storage.js';

const TOKEN_REFRESH_MARGIN = 60_000;
const OAUTH_CALLBACK_TIMEOUT = 5 * 60_000;
const OAUTH_SESSION_REFRESH_PROMISE_MAP = new Map<
  string,
  Promise<OAuthSession>
>();
const OAUTH_SESSION_LOAD_PROMISE_MAP = new Map<string, Promise<OAuthSession>>();
const OAUTH_UUID_PROMISE_MAP = new Map<string, Promise<string>>();

const OAuthTokenValue = x.object({
  accessToken: x.string,
  refreshToken: x.string,
  expiresIn: x.number,
  macKey: x.string.optional(),
});

const OAuthSessionValue = x.object({
  uuid: x.string,
  cloudServer: x.string,
  redirectUrl: x.string,
  expiresAt: x.string,
  token: OAuthTokenValue,
});

export function loadValidOAuthSession(path: string): Promise<OAuthSession> {
  let promise = OAUTH_SESSION_LOAD_PROMISE_MAP.get(path);

  if (promise === undefined) {
    promise = loadValidOAuthSessionValue(path);
    OAUTH_SESSION_LOAD_PROMISE_MAP.set(path, promise);
    void promise.then(
      () => {
        if (OAUTH_SESSION_LOAD_PROMISE_MAP.get(path) === promise) {
          OAUTH_SESSION_LOAD_PROMISE_MAP.delete(path);
        }
      },
      () => {
        if (OAUTH_SESSION_LOAD_PROMISE_MAP.get(path) === promise) {
          OAUTH_SESSION_LOAD_PROMISE_MAP.delete(path);
        }
      },
    );
  }

  return promise;
}

async function loadValidOAuthSessionValue(path: string): Promise<OAuthSession> {
  const session = await readOAuthSession(path);
  const expiresAt = Date.parse(session.expiresAt);

  if (Number.isNaN(expiresAt)) {
    throw new Error('OAuth session has an invalid expiration time.');
  } else if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN) {
    return session;
  }

  return joinOAuthSessionRefresh(path, session);
}

export async function beginOAuthSessionAuthorization(options: {
  readonly sessionPath: string;
  readonly uuidPath: string;
  readonly cloudServer: CloudServer;
  readonly redirectUrl?: string;
}): Promise<OAuthSessionAuthorization> {
  const {sessionPath, uuidPath, cloudServer} = options;
  const uuid = await loadOrCreateOAuthUuid(uuidPath);
  const redirectUrl = options.redirectUrl ?? getOAuthRedirectUrl(uuid);
  const oauthClient = new OAuthClient(uuid, cloudServer);
  const authorization = oauthClient.createAuthorization(redirectUrl);
  const callback = await startOAuthCallbackListener({
    expectedState: authorization.state,
    redirectUrl,
  });
  const completion = (async () => {
    const code = await callback.wait();
    const token = await oauthClient.exchangeCode(code, redirectUrl);
    const session = createOAuthSession(uuid, cloudServer, redirectUrl, token);

    await saveOAuthSession(sessionPath, session);
    return session;
  })();

  void completion.catch(() => undefined);
  return {
    url: authorization.url,
    wait: () => completion,
    cancel: () => callback.close(),
  };
}

export async function saveOAuthSession(
  path: string,
  session: OAuthSession,
): Promise<void> {
  await writePrivateJsonFile(path, session);
}

export function createOAuthSession(
  uuid: string,
  cloudServer: CloudServer,
  redirectUrl: string,
  token: OAuthToken,
): OAuthSession {
  return {
    uuid: validateUuid(uuid),
    cloudServer,
    redirectUrl,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    token,
  };
}

export type OAuthSessionAuthorization = {
  readonly url: string;
  wait(): Promise<OAuthSession>;
  cancel(): Promise<void>;
};

export type OAuthSession = {
  readonly uuid: string;
  readonly cloudServer: CloudServer;
  readonly redirectUrl: string;
  readonly expiresAt: string;
  readonly token: OAuthToken;
};

export class OAuthSessionMissingError extends Error {
  constructor() {
    super('OAuth session is missing.');
  }
}

async function readOAuthSession(path: string): Promise<OAuthSession> {
  let source: string;

  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new OAuthSessionMissingError();
    }

    throw error;
  }

  return parseOAuthSession(JSON.parse(source) as unknown);
}

function parseOAuthSession(value: unknown): OAuthSession {
  const session = OAuthSessionValue.satisfies(value);
  const {cloudServer} = session;

  if (!isCloudServer(cloudServer)) {
    throw new Error('OAuth session has an invalid cloud server.');
  }

  return {...session, uuid: validateUuid(session.uuid), cloudServer};
}

function joinOAuthSessionRefresh(
  path: string,
  session: OAuthSession,
): Promise<OAuthSession> {
  let refreshPromise = OAUTH_SESSION_REFRESH_PROMISE_MAP.get(path);

  if (refreshPromise === undefined) {
    const newRefreshPromise = refreshOAuthSession(path, session);

    refreshPromise = newRefreshPromise;
    OAUTH_SESSION_REFRESH_PROMISE_MAP.set(path, newRefreshPromise);

    const complete = (): void => {
      if (OAUTH_SESSION_REFRESH_PROMISE_MAP.get(path) === newRefreshPromise) {
        OAUTH_SESSION_REFRESH_PROMISE_MAP.delete(path);
      }
    };

    void newRefreshPromise.then(complete, complete);
  }

  return refreshPromise;
}

async function refreshOAuthSession(
  path: string,
  session: OAuthSession,
): Promise<OAuthSession> {
  const oauthClient = new OAuthClient(session.uuid, session.cloudServer);
  const token = await oauthClient.refreshToken(
    session.token.refreshToken,
    session.redirectUrl,
  );

  const refreshedSession = createOAuthSession(
    session.uuid,
    session.cloudServer,
    session.redirectUrl,
    token,
  );

  await saveOAuthSession(path, refreshedSession);
  return refreshedSession;
}

async function loadOrCreateOAuthUuid(path: string): Promise<string> {
  let uuidPromise = OAUTH_UUID_PROMISE_MAP.get(path);

  if (uuidPromise === undefined) {
    uuidPromise = loadOrCreateOAuthUuidFromStorage(path);
    OAUTH_UUID_PROMISE_MAP.set(path, uuidPromise);

    const complete = (): void => {
      if (OAUTH_UUID_PROMISE_MAP.get(path) === uuidPromise) {
        OAUTH_UUID_PROMISE_MAP.delete(path);
      }
    };

    void uuidPromise.then(complete, complete);
  }

  return uuidPromise;
}

async function loadOrCreateOAuthUuidFromStorage(path: string): Promise<string> {
  try {
    return await readOAuthUuid(path);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  const uuid = randomUUID().replaceAll('-', '');
  const created = await createPrivateJsonFile(path, uuid);

  return created ? uuid : readOAuthUuid(path);
}

async function readOAuthUuid(path: string): Promise<string> {
  return validateUuid(
    x.string.satisfies(JSON.parse(await readFile(path, 'utf8')) as unknown),
  );
}

function getOAuthRedirectUrl(uuid: string): string {
  // This is called virtual_did by the HA integration. Here it is only used as
  // the provider's stable webhook identifier required by Xiaomi's redirect URL.
  const virtualDid = BigInt(`0x${validateUuid(uuid).slice(0, 16)}`).toString();

  return `${OAUTH_REDIRECT_URL}/api/webhook/${virtualDid}`;
}

export async function startOAuthCallbackListener(options: {
  readonly expectedState: string;
  readonly redirectUrl: string;
  readonly timeout?: number;
}): Promise<OAuthCallbackListener> {
  const {expectedState} = options;
  const redirectUrl = new URL(options.redirectUrl);
  const result = createResult<string>();
  let outcome: OAuthCallbackOutcome | undefined;
  let settlementPromise: Promise<void> | undefined;
  const server = createServer((request, response) => {
    const callbackUrl = new URL(request.url ?? '/', redirectUrl);
    const state = callbackUrl.searchParams.get('state');
    const error = callbackUrl.searchParams.get('error');
    const code = callbackUrl.searchParams.get('code');

    if (outcome !== undefined) {
      response.writeHead(409);
      response.end('OAuth callback already received.');
    } else if (callbackUrl.pathname !== redirectUrl.pathname) {
      response.writeHead(404);
      response.end('Not found.');
    } else if (state !== expectedState) {
      response.writeHead(400);
      response.end('Invalid OAuth state.');
    } else if (error !== null) {
      outcome = {type: 'error', error: new Error(`OAuth failed: ${error}.`)};
      response.writeHead(400);
      response.end('OAuth failed.', closeConnections);
      void settle(false);
    } else if (code === null) {
      response.writeHead(400);
      response.end('Missing OAuth code.');
    } else {
      outcome = {type: 'code', code};
      response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'});
      response.end(
        'OAuth authorization received. You can close this tab.',
        closeConnections,
      );
      void settle(false);
    }
  });
  const handleError = (error: Error): void => {
    outcome ??= {type: 'error', error};
    void settle(true);
  };

  await listen(server, getRedirectPort(redirectUrl));
  server.on('error', handleError);
  const timeout = setTimeout(() => {
    outcome ??= {
      type: 'error',
      error: new Error('OAuth callback timed out.'),
    };
    void settle(true);
  }, options.timeout ?? OAUTH_CALLBACK_TIMEOUT);

  return {
    wait: () => result.promise,
    close: () => {
      outcome ??= {
        type: 'error',
        error: new Error('OAuth callback listener closed.'),
      };
      return settle(outcome.type !== 'code');
    },
  };

  function settle(force: boolean): Promise<void> {
    if (settlementPromise !== undefined) {
      return settlementPromise;
    }

    clearTimeout(timeout);

    server.off('error', handleError);

    const finalOutcome = outcome;

    if (finalOutcome === undefined) {
      throw new TypeError('OAuth callback settled without an outcome.');
    }

    const promise = closeServer(server, force).then(() => {
      if (finalOutcome.type === 'code') {
        result.resolve(finalOutcome.code);
      } else {
        result.reject(finalOutcome.error);
      }
    });

    settlementPromise = promise;
    return promise;
  }

  function closeConnections(): void {
    server.closeAllConnections();
  }
}

export type OAuthCallbackListener = {
  wait(): Promise<string>;
  close(): Promise<void>;
};

type OAuthCallbackOutcome =
  | {readonly type: 'code'; readonly code: string}
  | {readonly type: 'error'; readonly error: unknown};

function createResult<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  void promise.catch(() => undefined);
  return {promise, resolve, reject};
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port);
  });
}

function closeServer(server: Server, force: boolean): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });

    if (force) {
      server.closeAllConnections();
    }
  });
}

function getRedirectPort(url: URL): number {
  if (url.protocol !== 'http:') {
    throw new TypeError('OAuth callback URL must use HTTP.');
  }

  if (url.port !== '') {
    return Number(url.port);
  }

  return 80;
}

function validateUuid(uuid: string): string {
  if (!/^[\da-f]{32}$/u.test(uuid)) {
    throw new Error('OAuth environment UUID is invalid.');
  }

  return uuid;
}

function isCloudServer(value: string): value is CloudServer {
  return (CLOUD_SERVERS as readonly string[]).includes(value);
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT';
}
