/**
 * Control a specific Xiaomi device: turn on, wait, then turn off.
 *
 * Usage:
 *   node packages/xiaomi/bld/experiments/toggle-device.js
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {type AuthInfo, type CloudServer,OAUTH2_CLIENT_ID, XiaomiOAuthClient} from '../library/miot-exp/index.js';
import {XiaomiHttpClient} from '../library/miot-exp/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');
const AUTH_CACHE = join(CACHE_DIR, 'auth-info.json');
const UUID_CACHE = join(CACHE_DIR, 'uuid.txt');

const TARGET_DID = '358499433';
const TARGET_NAME = '大灯 (美岸/餐厅)';
const CLOUD_SERVER: CloudServer = 'cn';
const WAIT_MS = 5_000;

async function main(): Promise<void> {
  console.log(`=== 控制 ${TARGET_NAME} (${TARGET_DID}) ===\n`);

  // Load cached auth
  if (!existsSync(AUTH_CACHE)) {
    console.error(
      'No cached auth info found. Run control-light.js first to login.',
    );
    process.exit(1);
  }

  const authInfo: AuthInfo = JSON.parse(readFileSync(AUTH_CACHE, 'utf-8'));
  const uuid = readFileSync(UUID_CACHE, 'utf-8').trim();

  // Refresh token if expired
  let accessToken = authInfo.access_token;
  if (authInfo.expires_ts <= Math.floor(Date.now() / 1000) + 60) {
    console.log('Token expired, refreshing...');
    const oauth = new XiaomiOAuthClient({
      cloudServer: CLOUD_SERVER,
      uuid,
      redirectUrl: 'http://homeassistant.local:8123',
    });
    const refreshed = await oauth.refreshAccessToken(authInfo.refresh_token);
    accessToken = refreshed.access_token;
    console.log('✓ Token refreshed\n');
  }

  const http = new XiaomiHttpClient({
    cloudServer: CLOUD_SERVER,
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  // yeelink.light.ceiling22: siid=2 is the light service, piid=1 is on/off
  const siid = 2;
  const piid = 1;

  // Read current state
  console.log(`读取当前状态 (siid=${siid}, piid=${piid})...`);
  const currentValue = await http.getProp(TARGET_DID, siid, piid);
  console.log(`  当前值: ${JSON.stringify(currentValue)}\n`);

  // Turn ON
  console.log('>>> 开启设备...');
  const onResult = await http.setProp(TARGET_DID, siid, piid, true);
  console.log(`  结果: ${JSON.stringify(onResult)}`);

  await sleep(1000);
  const onReadBack = await http.getProp(TARGET_DID, siid, piid);
  console.log(`  读回: ${JSON.stringify(onReadBack)}\n`);

  // Wait
  console.log(`等待 ${WAIT_MS / 1000} 秒...\n`);
  await sleep(WAIT_MS);

  // Turn OFF
  console.log('>>> 关闭设备...');
  const offResult = await http.setProp(TARGET_DID, siid, piid, false);
  console.log(`  结果: ${JSON.stringify(offResult)}`);

  await sleep(1000);
  const offReadBack = await http.getProp(TARGET_DID, siid, piid);
  console.log(`  读回: ${JSON.stringify(offReadBack)}\n`);

  console.log('完成。');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
