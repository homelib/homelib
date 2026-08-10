export const OAUTH2_CLIENT_ID = '2882303761520251711';

export const DEFAULT_BACKEND_API_HOST = 'ha.api.io.mi.com';

export const BACKEND_API_TIMEOUT = 30_000;

export const DEFAULT_CLOUD_SERVER: CloudServer = 'cn';

export const CLOUD_SERVERS = ['cn', 'de', 'i2', 'ru', 'sg', 'us'] as const;

export type CloudServer = (typeof CLOUD_SERVERS)[number];

export function getBackendApiHost(cloudServer: CloudServer): string {
  return cloudServer === 'cn'
    ? DEFAULT_BACKEND_API_HOST
    : `${cloudServer}.${DEFAULT_BACKEND_API_HOST}`;
}
