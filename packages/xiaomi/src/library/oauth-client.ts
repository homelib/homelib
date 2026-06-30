/**
 * Xiaomi MIoT OAuth2 client.
 *
 * Implements the OAuth2 login flow used by the official ha_xiaomi_home
 * integration: generate an authorization URL, exchange the code for
 * access/refresh tokens, and refresh tokens when they expire.
 */

import {createHash, randomBytes} from 'node:crypto';
import {request} from 'node:https';

import {
  type CloudServer,
  MIHOME_HTTP_API_TIMEOUT,
  OAUTH2_AUTH_URL,
  OAUTH2_CLIENT_ID,
  TOKEN_EXPIRES_TS_RATIO,
  getApiHost,
} from './constants.js';

/** Token response from Xiaomi's `/get_token` endpoint. */
export type AuthInfo = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Computed: `now + expires_in * 0.7` (seconds, epoch). */
  expires_ts: number;
  /** Present in some responses; not required for cloud HTTP/MQTT. */
  mac_key?: string;
};

export type OAuthClientOptions = {
  cloudServer: CloudServer;
  /** Unique device identifier (e.g. 32-char hex). */
  uuid: string;
  /** Redirect URL registered with Xiaomi. */
  redirectUrl: string;
  /** Override client ID if needed (defaults to the HA integration ID). */
  clientId?: string;
};

export class XiaomiOAuthClient {
  private readonly clientId: string;
  private readonly redirectUrl: string;
  private readonly oauthHost: string;
  private readonly deviceId: string;
  private readonly state: string;

  constructor(options: OAuthClientOptions) {
    this.clientId = options.clientId ?? OAUTH2_CLIENT_ID;
    this.redirectUrl = options.redirectUrl;
    this.oauthHost = getApiHost(options.cloudServer);
    this.deviceId = `ha.${options.uuid}`;
    this.state = createHash('sha1').update(`d=${this.deviceId}`).digest('hex');
  }

  /** Generate the authorization URL for the user to visit in a browser. */
  genAuthUrl(redirectUrl?: string, state?: string): string {
    const params = new URLSearchParams({
      redirect_uri: redirectUrl ?? this.redirectUrl,
      client_id: String(this.clientId),
      response_type: 'code',
      device_id: this.deviceId,
      state: state ?? this.state,
      skip_confirm: 'true',
    });

    return `${OAUTH2_AUTH_URL}?${params.toString()}`;
  }

  /** Exchange an authorization code for access + refresh tokens. */
  async getAccessToken(code: string): Promise<AuthInfo> {
    return this.getToken({
      client_id: this.clientId,
      redirect_uri: this.redirectUrl,
      code,
      device_id: this.deviceId,
    });
  }

  /** Refresh an expired access token using the refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<AuthInfo> {
    return this.getToken({
      client_id: this.clientId,
      redirect_uri: this.redirectUrl,
      refresh_token: refreshToken,
    });
  }

  private async getToken(data: Record<string, unknown>): Promise<AuthInfo> {
    const url = `https://${this.oauthHost}/app/v2/ha/oauth/get_token`;
    // client_id exceeds Number.MAX_SAFE_INTEGER, so we manually inject it
    // as a raw JSON number to preserve precision.
    const dataStr = JSON.stringify(data).replace(
      /"client_id":"[^"]*"/,
      `"client_id":${this.clientId}`,
    );
    const params = new URLSearchParams({data: dataStr});
    const fullUrl = `${url}?${params.toString()}`;

    const res = await httpsGet(fullUrl, {
      'content-type': 'application/x-www-form-urlencoded',
    });

    if (res.status === 401) {
      throw new Error('OAuth unauthorized (401)');
    }
    if (res.status !== 200) {
      throw new Error(`OAuth get_token failed, HTTP ${res.status}`);
    }

    const body = JSON.parse(res.body);
    if (
      !body ||
      body.code !== 0 ||
      !body.result ||
      !body.result.access_token ||
      !body.result.refresh_token ||
      !body.result.expires_in
    ) {
      throw new Error(`Invalid OAuth response: ${res.body}`);
    }

    const result = body.result;
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
      expires_ts: Math.floor(
        Date.now() / 1000 + result.expires_in * TOKEN_EXPIRES_TS_RATIO,
      ),
      mac_key: result.mac_key,
    };
  }
}

/** Minimal HTTPS GET helper returning {status, body}. */
export function httpsGet(
  url: string,
  headers?: Record<string, string>,
): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        timeout: MIHOME_HTTP_API_TIMEOUT,
      },
      res => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          resolve({status: res.statusCode ?? 0, body});
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.end();
  });
}

/** Generate a random hex UUID (32 chars, matching HA integration format). */
export function generateUuid(): string {
  return randomBytes(16).toString('hex');
}
