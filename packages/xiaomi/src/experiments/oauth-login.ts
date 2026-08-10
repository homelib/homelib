import {createServer} from 'node:http';

import {DEFAULT_CLOUD_SERVER, OAuthClient} from '../library/index.js';

import {
  OAUTH_SESSION_PATH,
  createOAuthSession,
  getOAuthRedirectUrl,
  loadOrCreateUuid,
  saveOAuthSession,
} from './session.js';

async function main(): Promise<void> {
  const uuid = loadOrCreateUuid();
  const oauthClient = new OAuthClient(uuid, DEFAULT_CLOUD_SERVER);
  const redirectUrl = getOAuthRedirectUrl(uuid);
  const authorization = oauthClient.createAuthorization(redirectUrl);
  const callback = waitForCallback(authorization.state, redirectUrl);

  console.info(`Open this URL to authorize homelib:\n\n${authorization.url}\n`);

  const code = await callback;
  const token = await oauthClient.exchangeCode(code, redirectUrl);

  saveOAuthSession(
    createOAuthSession(uuid, DEFAULT_CLOUD_SERVER, redirectUrl, token),
  );
  console.info(`OAuth succeeded. Session saved to ${OAUTH_SESSION_PATH}.`);
}

function waitForCallback(
  expectedState: string,
  redirectUrlValue: string,
): Promise<string> {
  const redirectUrl = new URL(redirectUrlValue);
  const port = Number(redirectUrl.port);

  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const callbackUrl = new URL(request.url ?? '/', redirectUrl);
      const error = callbackUrl.searchParams.get('error');
      const code = callbackUrl.searchParams.get('code');
      const state = callbackUrl.searchParams.get('state');

      if (callbackUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404);
        response.end('Not found.');
      } else if (error !== null) {
        response.writeHead(400);
        response.end('OAuth failed.');
        finish(() => reject(new Error(`OAuth failed: ${error}.`)));
      } else if (state !== expectedState) {
        response.writeHead(400);
        response.end('Invalid OAuth state.');
      } else if (code === null) {
        response.writeHead(400);
        response.end('Missing OAuth code.');
      } else {
        response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'});
        response.end('OAuth authorization received. You can close this tab.');
        finish(() => resolve(code));
      }
    });
    const timeout = setTimeout(
      () => {
        finish(() => reject(new Error('OAuth callback timed out.')));
      },
      5 * 60 * 1000,
    );

    server.on('error', error => {
      finish(() => reject(error));
    });
    server.listen(port);

    function finish(callback: () => void): void {
      clearTimeout(timeout);
      server.close();
      server.closeAllConnections();
      callback();
    }
  });
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
