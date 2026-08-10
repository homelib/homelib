/**
 * Demo 1: Cloud control via HTTP API.
 *
 * This is the simplest control path — all commands go through Xiaomi Cloud.
 * No local network access to the device is required.
 *
 * Flow: OAuth token → HTTP API → get/set device properties
 */

import {OAUTH2_CLIENT_ID,XiaomiHttpClient} from '../library/miot-exp/index.js';

import {
  TARGET_DID,
  TARGET_NAME,
  TARGET_PIID,
  TARGET_SIID,
  ensureAccessToken,
  sleep,
} from './shared.js';

async function main(): Promise<void> {
  console.log('=== Demo 1: 云端控制 (HTTP API) ===\n');
  console.log(`目标设备: ${TARGET_NAME} (${TARGET_DID})`);
  console.log(`控制属性: siid=${TARGET_SIID}, piid=${TARGET_PIID}\n`);

  const {accessToken} = await ensureAccessToken('cn');

  const http = new XiaomiHttpClient({
    cloudServer: 'cn',
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  // Read current state
  console.log('读取当前状态...');
  const currentValue = await http.getProp(TARGET_DID, TARGET_SIID, TARGET_PIID);
  console.log(`  当前值: ${JSON.stringify(currentValue)}\n`);

  // Turn ON
  console.log('>>> 开启设备 (云端)...');
  const onResult = await http.setProp(
    TARGET_DID,
    TARGET_SIID,
    TARGET_PIID,
    true,
  );
  console.log(`  结果: ${JSON.stringify(onResult)}`);
  await sleep(1000);
  const onReadBack = await http.getProp(TARGET_DID, TARGET_SIID, TARGET_PIID);
  console.log(`  读回: ${JSON.stringify(onReadBack)}\n`);

  // Wait
  console.log('等待 5 秒...\n');
  await sleep(5000);

  // Turn OFF
  console.log('>>> 关闭设备 (云端)...');
  const offResult = await http.setProp(
    TARGET_DID,
    TARGET_SIID,
    TARGET_PIID,
    false,
  );
  console.log(`  结果: ${JSON.stringify(offResult)}`);
  await sleep(1000);
  const offReadBack = await http.getProp(TARGET_DID, TARGET_SIID, TARGET_PIID);
  console.log(`  读回: ${JSON.stringify(offReadBack)}\n`);

  console.log('完成。');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
