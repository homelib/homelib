/**
 * Demo 3: LAN direct control via UDP OT protocol.
 *
 * This control path communicates directly with WiFi-enabled Xiaomi devices
 * on the local network, bypassing both the cloud and the central hub gateway.
 *
 * Flow:
 *   1. Get device token from cloud API (needed for encryption)
 *   2. Probe device via UDP broadcast (port 54321)
 *   3. Send encrypted get/set property commands
 *
 * Requirements:
 *   - Target device must be a WiFi IP device on the same local network
 *   - Device token (from cloud device list) is required for AES encryption
 *   - Does NOT work with BLE Mesh, ZigBee, or sub-devices of a gateway
 */

import {OAUTH2_CLIENT_ID,XiaomiHttpClient,XiaomiLanClient} from '../library/index.js';

import {
  TARGET_DID,
  TARGET_NAME,
  TARGET_PIID,
  TARGET_SIID,
  ensureAccessToken,
  sleep,
} from './shared.js';

async function main(): Promise<void> {
  console.log('=== Demo 3: LAN 直连控制 (UDP OT 协议) ===\n');
  console.log(`目标设备: ${TARGET_NAME} (${TARGET_DID})`);
  console.log(`控制属性: siid=${TARGET_SIID}, piid=${TARGET_PIID}\n`);

  // Step 1: Get device token and IP from cloud API
  console.log('从云端获取设备 token 和 IP...');
  const {accessToken} = await ensureAccessToken('cn');

  const http = new XiaomiHttpClient({
    cloudServer: 'cn',
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  const devicesResult = await http.getDevices();
  const device = devicesResult.devices[TARGET_DID];

  if (!device) {
    console.error(`✗ 设备 ${TARGET_DID} 不在设备列表中`);
    process.exit(1);
  }

  console.log(`  设备名: ${device.name}`);
  console.log(`  型号: ${device.model}`);
  console.log(`  在线: ${device.online}`);
  console.log(`  token: ${device.token ?? '(无)'}`);
  console.log(`  local_ip: ${device.local_ip ?? '(无)'}`);

  if (!device.token) {
    console.error('\n✗ 设备没有 token，无法进行 LAN 直连控制。');
    console.error(
      '  这可能是因为该设备通过网关连接（BLE/ZigBee），而非 WiFi 直连。',
    );
    process.exit(1);
  }

  if (!device.local_ip) {
    console.error('\n✗ 设备没有 local_ip，无法进行 LAN 直连控制。');
    console.error('  请确认设备是否为 WiFi IP 设备且与本机在同一局域网。');
    process.exit(1);
  }

  console.log(`\n  → 设备 IP: ${device.local_ip}`);
  console.log(
    `  → 设备 token: ${device.token.slice(0, 8)}...${device.token.slice(-8)}\n`,
  );

  // Step 2: Create LAN client and probe device
  console.log('初始化 LAN 客户端...');
  const lan = new XiaomiLanClient({
    did: TARGET_DID,
    token: device.token,
    ip: device.local_ip,
  });

  await lan.init();
  console.log('✓ UDP socket 已绑定\n');

  console.log('探测设备 (UDP)...');
  const probed = await lan.probe(5000);
  if (!probed) {
    console.error('✗ 设备无响应。请确认:');
    console.error('  1. 设备与本机在同一局域网');
    console.error('  2. 设备支持 LAN 直连（WiFi IP 设备）');
    console.error('  3. 防火墙未阻止 UDP 54321 端口');
    await lan.close();
    process.exit(1);
  }
  console.log('✓ 设备已响应\n');

  // Step 3: Control device
  // Read current state
  console.log('读取当前状态 (LAN 直连)...');
  try {
    const currentValue = await lan.getProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
    );
    console.log(`  当前值: ${JSON.stringify(currentValue)}\n`);

    // Turn ON
    console.log('>>> 开启设备 (LAN 直连)...');
    const onResult = await lan.setProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
      true,
    );
    console.log(`  结果: ${JSON.stringify(onResult)}`);
    await sleep(1000);
    const onReadBack = await lan.getProp(TARGET_DID, TARGET_SIID, TARGET_PIID);
    console.log(`  读回: ${JSON.stringify(onReadBack)}\n`);

    // Wait
    console.log('等待 5 秒...\n');
    await sleep(5000);

    // Turn OFF
    console.log('>>> 关闭设备 (LAN 直连)...');
    const offResult = await lan.setProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
      false,
    );
    console.log(`  结果: ${JSON.stringify(offResult)}`);
    await sleep(1000);
    const offReadBack = await lan.getProp(TARGET_DID, TARGET_SIID, TARGET_PIID);
    console.log(`  读回: ${JSON.stringify(offReadBack)}\n`);
  } catch (err) {
    console.error(`✗ LAN 控制失败: ${(err as Error).message}`);
  }

  await lan.close();
  console.log('完成。');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
