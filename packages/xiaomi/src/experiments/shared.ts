/**
 * Shared utilities for experiment scripts.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {type AuthInfo, type CloudServer,
  OAUTH2_CLIENT_ID,
  XiaomiOAuthClient,
  generateUuid} from '../library/miot-exp/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(__dirname, '.cache');
const AUTH_CACHE = join(CACHE_DIR, 'auth-info.json');
const UUID_CACHE = join(CACHE_DIR, 'uuid.txt');

/** Load or create a persistent UUID. */
export function loadOrCreateUuid(): string {
  mkdirSync(CACHE_DIR, {recursive: true});
  if (existsSync(UUID_CACHE)) {
    return readFileSync(UUID_CACHE, 'utf-8').trim();
  }
  const uuid = generateUuid();
  writeFileSync(UUID_CACHE, uuid);
  return uuid;
}

/** Load cached auth info. */
export function loadAuthInfo(): AuthInfo {
  if (!existsSync(AUTH_CACHE)) {
    throw new Error(
      'No cached auth info. Run control-light.js first to login.',
    );
  }
  return JSON.parse(readFileSync(AUTH_CACHE, 'utf-8'));
}

/** Save auth info to cache. */
export function saveAuthInfo(authInfo: AuthInfo): void {
  mkdirSync(CACHE_DIR, {recursive: true});
  writeFileSync(AUTH_CACHE, JSON.stringify(authInfo, null, 2));
}

/**
 * Ensure we have a valid access token, refreshing if needed.
 * Returns the current valid access token.
 */
export async function ensureAccessToken(
  cloudServer: CloudServer = 'cn',
): Promise<{accessToken: string; authInfo: AuthInfo; uuid: string}> {
  const authInfo = loadAuthInfo();
  const uuid = loadOrCreateUuid();

  let accessToken = authInfo.access_token;
  if (authInfo.expires_ts <= Math.floor(Date.now() / 1000) + 60) {
    console.log('Token expired, refreshing...');
    const oauth = new XiaomiOAuthClient({
      cloudServer,
      uuid,
      redirectUrl: 'http://homeassistant.local:8123',
    });
    const refreshed = await oauth.refreshAccessToken(authInfo.refresh_token);
    accessToken = refreshed.access_token;
    saveAuthInfo(refreshed);
    console.log('✓ Token refreshed\n');
  }

  return {accessToken, authInfo, uuid};
}

/** The target device for demos: 大灯 in 美岸/餐厅. */
export const TARGET_DID = '358499433';
export const TARGET_NAME = '大灯 (美岸/餐厅)';
export const TARGET_SIID = 2;
export const TARGET_PIID = 1;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
