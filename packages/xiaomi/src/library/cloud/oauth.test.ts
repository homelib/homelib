import {
  OAUTH2_AUTH_URL,
  OAUTH2_CLIENT_ID,
  OAUTH_REDIRECT_URL,
} from './constants.js';
import {OAuthClient} from './oauth.js';

test('creates an OAuth authorization', () => {
  const authorization = new OAuthClient('test-uuid').createAuthorization();
  const url = new URL(authorization.url);

  expect(`${url.origin}${url.pathname}`).toBe(OAUTH2_AUTH_URL);
  expect(url.searchParams.get('redirect_uri')).toBe(OAUTH_REDIRECT_URL);
  expect(url.searchParams.get('client_id')).toBe(OAUTH2_CLIENT_ID);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('device_id')).toBe('ha.test-uuid');
  expect(url.searchParams.get('state')).toBe(authorization.state);
  expect(url.searchParams.get('skip_confirm')).toBe('false');
});
