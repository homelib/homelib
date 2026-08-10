import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import * as x from 'x-value';

import {
  CLOUD_SERVERS,
  type CloudServer,
  OAuthClient,
  type OAuthToken,
} from './backend/index.js';

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

export async function loadValidOAuthSession(
  path: string,
): Promise<OAuthSession> {
  let session = parseOAuthSession(
    JSON.parse(await readFile(path, 'utf8')) as unknown,
  );
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
  session = createOAuthSession(session, token);
  await saveOAuthSession(path, session);

  return session;
}

export type OAuthSession = {
  readonly uuid: string;
  readonly cloudServer: CloudServer;
  readonly redirectUrl: string;
  readonly expiresAt: string;
  readonly token: OAuthToken;
};

function parseOAuthSession(value: unknown): OAuthSession {
  const session = OAuthSessionValue.satisfies(value);
  const {cloudServer} = session;

  if (!isCloudServer(cloudServer)) {
    throw new Error('OAuth session has an invalid cloud server.');
  }

  return {...session, cloudServer};
}

function createOAuthSession(
  session: OAuthSession,
  token: OAuthToken,
): OAuthSession {
  return {
    uuid: session.uuid,
    cloudServer: session.cloudServer,
    redirectUrl: session.redirectUrl,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    token,
  };
}

async function saveOAuthSession(
  path: string,
  session: OAuthSession,
): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await writeFile(path, JSON.stringify(session, undefined, 2), {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function isCloudServer(value: string): value is CloudServer {
  return (CLOUD_SERVERS as readonly string[]).includes(value);
}
