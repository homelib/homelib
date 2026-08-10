import {randomBytes} from 'node:crypto';

import {
  OAUTH2_AUTH_URL,
  OAUTH2_CLIENT_ID,
  OAUTH_REDIRECT_URL,
} from './constants.js';

export class OAuthClient {
  constructor(private readonly uuid: string) {}

  createAuthorization(redirectUrl = OAUTH_REDIRECT_URL): OAuthAuthorization {
    const state = randomBytes(32).toString('hex');
    const parameters = new URLSearchParams({
      redirect_uri: redirectUrl,
      client_id: OAUTH2_CLIENT_ID,
      response_type: 'code',
      device_id: `ha.${this.uuid}`,
      state,
      skip_confirm: 'false',
    });

    return {
      url: `${OAUTH2_AUTH_URL}?${parameters.toString()}`,
      state,
    };
  }
}

export type OAuthAuthorization = {
  readonly url: string;
  readonly state: string;
};
