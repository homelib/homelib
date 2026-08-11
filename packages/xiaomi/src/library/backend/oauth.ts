import {createHash} from 'node:crypto';

import * as x from 'x-value';

import {
  BACKEND_API_TIMEOUT,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
  OAUTH2_CLIENT_ID,
  getBackendApiHost,
} from './constants.js';

export const OAUTH2_AUTH_URL = 'https://account.xiaomi.com/oauth2/authorize';

export const OAUTH_REDIRECT_URL = 'http://homeassistant.local:8123';

const OAuthTokenResponse = x.object({
  code: x.number,
  message: x.string.optional(),
  result: x
    .object({
      access_token: x.string.optional(),
      refresh_token: x.string.optional(),
      expires_in: x.number.optional(),
      mac_key: x.string.optional(),
      error: x.number.optional(),
      error_description: x.string.optional(),
    })
    .optional(),
});

export class OAuthClient {
  /** Identifies this MIoT provider to Xiaomi, not a physical device. */
  private readonly deviceId: string;

  private readonly apiHost: string;

  constructor(uuid: string, cloudServer: CloudServer = DEFAULT_CLOUD_SERVER) {
    this.deviceId = `ha.${uuid}`;
    this.apiHost = getBackendApiHost(cloudServer);
  }

  createAuthorization(redirectUrl = OAUTH_REDIRECT_URL): OAuthAuthorization {
    // Xiaomi's HA OAuth flow derives state from device_id instead of using a
    // conventional random OAuth nonce. The callback is still checked against it.
    const state = createHash('sha1').update(`d=${this.deviceId}`).digest('hex');
    const parameters = new URLSearchParams({
      redirect_uri: redirectUrl,
      client_id: OAUTH2_CLIENT_ID,
      response_type: 'code',
      device_id: this.deviceId,
      state,
      skip_confirm: 'false',
    });

    return {
      url: `${OAUTH2_AUTH_URL}?${parameters.toString()}`,
      state,
    };
  }

  async exchangeCode(
    code: string,
    redirectUrl = OAUTH_REDIRECT_URL,
  ): Promise<OAuthToken> {
    return this.requestToken({
      redirect_uri: redirectUrl,
      code,
      device_id: this.deviceId,
    });
  }

  async refreshToken(
    refreshToken: string,
    redirectUrl = OAUTH_REDIRECT_URL,
  ): Promise<OAuthToken> {
    return this.requestToken({
      redirect_uri: redirectUrl,
      refresh_token: refreshToken,
    });
  }

  private requestToken(data: Record<string, string>): Promise<OAuthToken> {
    return withRequestTimeout(
      this.fetchToken(data),
      'OAuth token request timed out.',
    );
  }

  private async fetchToken(data: Record<string, string>): Promise<OAuthToken> {
    const url = new URL(
      '/app/v2/ha/oauth/get_token',
      `https://${this.apiHost}`,
    );
    url.searchParams.set('data', createTokenRequestData(data));

    const response = await fetch(url, {
      headers: {'content-type': 'application/x-www-form-urlencoded'},
    });

    if (response.status === 401) {
      throw new Error('OAuth token request was rejected.');
    } else if (!response.ok) {
      throw new Error(`OAuth token request failed: ${response.status}.`);
    }

    const {
      code: responseCode,
      message,
      result,
    } = OAuthTokenResponse.satisfies(await response.json());

    if (responseCode !== 0) {
      const errorCode = result?.error;
      const description = result?.error_description ?? message;
      throw new Error(
        `OAuth token request failed: ${responseCode}${errorCode === undefined ? '' : `/${errorCode}`}${description === undefined ? '' : ` (${description})`}.`,
      );
    } else if (
      result === undefined ||
      result.access_token === undefined ||
      result.refresh_token === undefined ||
      result.expires_in === undefined
    ) {
      throw new Error('OAuth token response is missing token data.');
    }

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresIn: result.expires_in,
      macKey: result.mac_key,
    };
  }
}

export type OAuthAuthorization = {
  readonly url: string;
  readonly state: string;
};

export type OAuthToken = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly macKey?: string;
};

function createTokenRequestData(data: Record<string, string>): string {
  return `{"client_id":${OAUTH2_CLIENT_ID},${JSON.stringify(data).slice(1)}`;
}

function withRequestTimeout<T>(
  request: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, BACKEND_API_TIMEOUT);
  });

  // This only bounds the caller's wait; the underlying fetch keeps running.
  return Promise.race([request, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
