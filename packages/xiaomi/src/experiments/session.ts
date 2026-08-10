import {randomUUID} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import * as x from 'x-value';

import {
  CLOUD_SERVERS,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
  OAUTH_REDIRECT_URL,
  OAuthClient,
  type OAuthToken,
} from '../library/index.js';

const TOKEN_REFRESH_MARGIN = 60_000;

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

export const CACHE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '.cache',
);

export const OAUTH_SESSION_PATH = join(CACHE_DIRECTORY, 'oauth-session.json');

const UUID_PATH = join(CACHE_DIRECTORY, 'uuid.txt');
const LEGACY_TOKEN_PATH = join(CACHE_DIRECTORY, 'oauth-token.json');

export function loadOrCreateUuid(): string {
  mkdirSync(CACHE_DIRECTORY, {recursive: true, mode: 0o700});

  if (existsSync(UUID_PATH)) {
    return validateUuid(readFileSync(UUID_PATH, 'utf8').trim());
  }

  const uuid = randomUUID().replaceAll('-', '');
  writeFileSync(UUID_PATH, uuid, {mode: 0o600});
  return uuid;
}

export function getOAuthRedirectUrl(uuid: string): string {
  // This is called virtual_did by the HA integration. Here it is only used as
  // the stable webhook identifier required by Xiaomi's registered redirect URL.
  const virtualDid = BigInt(`0x${validateUuid(uuid).slice(0, 16)}`).toString();
  return `${OAUTH_REDIRECT_URL}/api/webhook/${virtualDid}`;
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

export function saveOAuthSession(session: OAuthSession): void {
  mkdirSync(CACHE_DIRECTORY, {recursive: true, mode: 0o700});
  writeFileSync(OAUTH_SESSION_PATH, JSON.stringify(session, undefined, 2), {
    mode: 0o600,
  });
  chmodSync(OAUTH_SESSION_PATH, 0o600);

  if (existsSync(LEGACY_TOKEN_PATH)) {
    unlinkSync(LEGACY_TOKEN_PATH);
  }
}

export async function loadValidOAuthSession(): Promise<OAuthSession> {
  let session = loadOAuthSession();
  const expiresAt = Date.parse(session.expiresAt);

  if (Number.isNaN(expiresAt)) {
    throw new Error('OAuth session has an invalid expiration time.');
  } else if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN) {
    return session;
  }

  const oauthClient = new OAuthClient(session.uuid, session.cloudServer);
  const token = await oauthClient.refreshToken(
    session.token.refreshToken,
    session.redirectUrl,
  );
  session = createOAuthSession(
    session.uuid,
    session.cloudServer,
    session.redirectUrl,
    token,
  );
  saveOAuthSession(session);
  return session;
}

export type OAuthSession = {
  readonly uuid: string;
  readonly cloudServer: CloudServer;
  readonly redirectUrl: string;
  readonly expiresAt: string;
  readonly token: OAuthToken;
};

function loadOAuthSession(): OAuthSession {
  if (existsSync(OAUTH_SESSION_PATH)) {
    return parseOAuthSession(readJson(OAUTH_SESSION_PATH));
  } else if (existsSync(LEGACY_TOKEN_PATH)) {
    const uuid = loadOrCreateUuid();
    const token = OAuthTokenValue.satisfies(readJson(LEGACY_TOKEN_PATH));

    return {
      uuid,
      cloudServer: DEFAULT_CLOUD_SERVER,
      redirectUrl: getOAuthRedirectUrl(uuid),
      expiresAt: new Date(0).toISOString(),
      token,
    };
  }

  throw new Error('OAuth session is missing. Run oauth.js first.');
}

function parseOAuthSession(value: unknown): OAuthSession {
  const session = OAuthSessionValue.satisfies(value);

  if (!isCloudServer(session.cloudServer)) {
    throw new Error('OAuth session has an invalid cloud server.');
  }

  return {
    uuid: validateUuid(session.uuid),
    cloudServer: session.cloudServer,
    redirectUrl: session.redirectUrl,
    expiresAt: session.expiresAt,
    token: session.token,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
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
