/**
 * Xiaomi MIoT cloud constants.
 *
 * Derived from the official ha_xiaomi_home integration:
 * https://github.com/XiaoMi/ha_xiaomi_home
 */

/** OAuth2 client ID registered with Xiaomi. DO NOT CHANGE. */
export const OAUTH2_CLIENT_ID = '2882303761520251711';

/** OAuth2 authorization URL. */
export const OAUTH2_AUTH_URL = 'https://account.xiaomi.com/oauth2/authorize';

/** Default API host for the CN (mainland China) cloud server. */
export const DEFAULT_OAUTH2_API_HOST = 'ha.api.io.mi.com';

/** Default MQTT broker host (CN). */
export const DEFAULT_CLOUD_BROKER_HOST = 'ha.mqtt.io.mi.com';

/** HTTP API timeout in milliseconds. */
export const MIHOME_HTTP_API_TIMEOUT = 30_000;

/** MQTT keep-alive interval in seconds. */
export const MIHOME_MQTT_KEEPALIVE = 60;

/** Token expiration ratio — refresh at 70% of lifetime. */
export const TOKEN_EXPIRES_TS_RATIO = 0.7;

/** Default cloud server region. */
export const DEFAULT_CLOUD_SERVER = 'cn' as const;

/** Supported cloud server regions. */
export const CLOUD_SERVERS = {
  cn: '中国大陆',
  de: 'Europe',
  i2: 'India',
  ru: 'Russia',
  sg: 'Singapore',
  us: 'United States',
} as const;

export type CloudServer = keyof typeof CLOUD_SERVERS;

/** Regions that support central hub gateway control (local mode). */
export const SUPPORT_CENTRAL_GATEWAY_CTRL: CloudServer[] = ['cn'];

/** Xiaomi MIoT CA certificate (for central hub gateway mTLS). */
export const MIHOME_CA_CERT = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBazCCAQ+gAwIBAgIEA/UKYDAMBggqhkjOPQQDAgUAMCIxEzARBgNVBAoTCk1p',
  'amlhIFJvb3QxCzAJBgNVBAYTAkNOMCAXDTE2MTEyMzAxMzk0NVoYDzIwNjYxMTEx',
  'MDEzOTQ1WjAiMRMwEQYDVQQKEwpNaWppYSBSb290MQswCQYDVQQGEwJDTjBZMBMG',
  'ByqGSM49AgEGCCqGSM49AwEHA0IABL71iwLa4//4VBqgRI+6xE23xpovqPCxtv96',
  '2VHbZij61/Ag6jmi7oZ/3Xg/3C+whglcwoUEE6KALGJ9vccV9PmjLzAtMAwGA1Ud',
  'EwQFMAMBAf8wHQYDVR0OBBYEFJa3onw5sblmM6n40QmyAGDI5sURMAwGCCqGSM49',
  'BAMCBQADSAAwRQIgchciK9h6tZmfrP8Ka6KziQ4Lv3hKfrHtAZXMHPda4IYCIQCG',
  'az93ggFcbrG9u2wixjx1HKW4DUA5NXZG0wWQTpJTbQ==',
  '-----END CERTIFICATE-----',
  '-----BEGIN CERTIFICATE-----',
  'MIIBjzCCATWgAwIBAgIBATAKBggqhkjOPQQDAjAiMRMwEQYDVQQKEwpNaWppYSBS',
  'b290MQswCQYDVQQGEwJDTjAgFw0yMjA2MDkxNDE0MThaGA8yMDcyMDUyNzE0MTQx',
  'OFowLDELMAkGA1UEBhMCQ04xHTAbBgNVBAoMFE1JT1QgQ0VOVFJBTCBHQVRFV0FZ',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdYrzbnp/0x/cZLZnuEDXTFf8mhj4',
  'CVpZPwgj9e9Ve5r3K7zvu8Jjj7JF1JjQYvEC6yhp1SzBgglnK4L8xQzdiqNQME4w',
  'HQYDVR0OBBYEFCf9+YBU7pXDs6K6CAQPRhlGJ+cuMB8GA1UdIwQYMBaAFJa3onw5',
  'sblmM6n40QmyAGDI5sURMAwGA1UdEwQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIh',
  'AKUv+c8v98vypkGMTzMwckGjjVqTef8xodsy6PhcSCq+AiA/n9mDs62hAo5zXyJy',
  'Bs1s7mqXPf1XgieoxIvs1MqyiA==',
  '-----END CERTIFICATE-----',
  '',
].join('\n');

/**
 * Returns the API host for a given cloud server region.
 * CN uses the bare host; other regions prefix the region code.
 */
export function getApiHost(cloudServer: CloudServer): string {
  return cloudServer === 'cn'
    ? DEFAULT_OAUTH2_API_HOST
    : `${cloudServer}.${DEFAULT_OAUTH2_API_HOST}`;
}

/**
 * Returns the MQTT broker host for a given cloud server region.
 * All regions prefix with `{cloudServer}-`.
 */
export function getBrokerHost(cloudServer: CloudServer): string {
  return `${cloudServer}-${DEFAULT_CLOUD_BROKER_HOST}`;
}
