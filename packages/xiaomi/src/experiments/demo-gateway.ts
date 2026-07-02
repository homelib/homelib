/**
 * Demo 2: Central hub gateway local control via mTLS MQTT.
 *
 * This control path goes through a Xiaomi central hub gateway on the local
 * network. Commands are sent via MQTT over mutual TLS (mTLS), bypassing
 * Xiaomi Cloud entirely.
 *
 * Flow:
 *   1. mDNS discovery → find gateway IP, port, group_id, did
 *   2. OAuth token → get user certificate (CSR → cloud API → signed cert)
 *   3. mTLS MQTT connect to gateway
 *   4. Send get/set property commands via `proxy/rpcReq` topic
 *
 * Requirements:
 *   - A Xiaomi central hub gateway on the same local network
 *   - openssl CLI available (for CSR generation)
 *   - CN cloud server (central gateway only supported in mainland China)
 */

import {OAUTH2_CLIENT_ID,XiaomiCertManager,XiaomiHttpClient,XiaomiLocalMqttClient, calcGroupId} from '../library/index.js';
import {
  type GatewayInfo,
  discoverGatewaysWithFallback,
} from '../library/index.js';

import {
  CACHE_DIR,
  TARGET_DID,
  TARGET_NAME,
  TARGET_PIID,
  TARGET_SIID,
  ensureAccessToken,sleep
} from './shared.js';

async function main(): Promise<void> {
  console.log('=== Demo 2: 中枢网关本地控制 (mTLS MQTT) ===\n');
  console.log(`目标设备: ${TARGET_NAME} (${TARGET_DID})`);
  console.log(`控制属性: siid=${TARGET_SIID}, piid=${TARGET_PIID}\n`);

  // Step 1: Get auth info and cloud device list (needed for gateway DID)
  const {accessToken} = await ensureAccessToken('cn');

  const http = new XiaomiHttpClient({
    cloudServer: 'cn',
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  const devicesResult = await http.getDevices();
  const uid = devicesResult.uid;
  console.log(`用户 UID: ${uid}\n`);

  // Find potential central hub gateways from cloud device list.
  // Central hub gateway can be a standalone device (xiaomi.gateway.hub1) or
  // built into a router (xiaomi.router.*). We look for devices in the user's
  // own homes (not shared) that could be gateways.
  const ownHomes = new Set(Object.keys(devicesResult.homes.home_list ?? {}));
  const candidates: Array<{
    did: string;
    name: string;
    model: string;
    homeId: string;
  }> = [];

  for (const [did, dev] of Object.entries(devicesResult.devices)) {
    // Only consider devices in the user's own homes
    if (!ownHomes.has(dev.home_id)) continue;
    // Look for gateway or router models
    if (dev.model.includes('gateway') || dev.model.includes('router')) {
      candidates.push({
        did,
        name: dev.name,
        model: dev.model,
        homeId: dev.home_id,
      });
    }
  }

  if (candidates.length === 0) {
    console.error('✗ 账号下没有可能作为中枢网关的设备');
    process.exit(1);
  }

  console.log(`找到 ${candidates.length} 个候选网关设备:`);
  for (const c of candidates) {
    console.log(`  - ${c.name} (did=${c.did}) model=${c.model}`);
  }
  console.log();

  // Step 2: Discover gateway on local network
  // Try mDNS first, then fall back to subnet scan (for WSL/Docker where
  // mDNS multicast doesn't work). Pass all candidate DIDs so the scan can
  // find whichever one is on the local network.
  console.log('正在发现局域网内的中枢网关...');
  console.log('  (先尝试 mDNS, 失败则扫描局域网)\n');

  const candidateDids = candidates.map(c => c.did);
  const discovered = await discoverGatewaysWithFallback(candidateDids, 15_000);

  let gateways: GatewayInfo[];
  let gatewayHomeId = '';

  if (discovered.length > 0) {
    // Find which candidate matched
    const matched =
      candidates.find(c => c.did === discovered[0]!.did) ?? candidates[0]!;
    gatewayHomeId = matched.homeId;
    gateways = discovered.map(gw => {
      if (!gw.group_id) {
        gw.group_id = calcGroupId(uid, gatewayHomeId);
      }
      return gw;
    });
  } else {
    console.error('✗ 未找到中枢网关。请确保:');
    console.error('  1. 中枢网关与本机在同一局域网');
    console.error('  2. 中枢网关已开机并联网');
    process.exit(1);
  }

  console.log(`✓ 找到 ${gateways.length} 个网关:`);
  for (const gw of gateways) {
    console.log(
      `  - ${gw.name} did=${gw.did} ip=${gw.address}:${gw.port} group_id=${gw.group_id}`,
    );
  }
  console.log();

  const gateway = gateways[0]!;
  console.log(`使用网关: ${gateway.address}:${gateway.port}\n`);

  // Step 3: Ensure user certificate
  const {uuid} = await ensureAccessToken('cn');

  const certDir = join(CACHE_DIR, 'cert');
  const certManager = new XiaomiCertManager(certDir, uid, 'cn');

  console.log('检查用户证书...');
  const virtualDid = BigInt(`0x${  uuid.slice(0, 16)}`).toString();
  await certManager.ensureUserCert(virtualDid, async (csr: string) => {
    console.log('  请求云端签发证书...');
    const cert = await http.getCentralCert(csr);
    console.log('  ✓ 证书已签发');
    return cert;
  });
  console.log('✓ 用户证书就绪\n');

  // Step 4: Connect to gateway via mTLS MQTT
  console.log('连接网关 MQTT broker (mTLS)...');
  const localMqtt = new XiaomiLocalMqttClient({
    did: virtualDid,
    host: gateway.address,
    port: gateway.port,
    caFile: certManager.caPath,
    certFile: certManager.certPath,
    keyFile: certManager.keyPath,
    homeName: gateway.name,
  });

  try {
    await localMqtt.connect();
    console.log('✓ 已连接网关\n');

    // Get device list from gateway
    console.log('获取网关设备列表...');
    const devList = await localMqtt.getDevList();
    const devCount = Object.keys(devList).length;
    console.log(`  网关下有 ${devCount} 个设备`);
    if (TARGET_DID in devList) {
      console.log(`  ✓ 目标设备 ${TARGET_DID} 在网关下\n`);
    } else {
      console.log(`  ⚠ 目标设备 ${TARGET_DID} 不在网关下，仍尝试控制...\n`);
    }

    // Read current state
    console.log('读取当前状态 (本地)...');
    const currentValue = await localMqtt.getProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
    );
    console.log(`  当前值: ${JSON.stringify(currentValue)}\n`);

    // Turn ON
    console.log('>>> 开启设备 (本地)...');
    const onResult = await localMqtt.setProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
      true,
    );
    console.log(`  结果: ${JSON.stringify(onResult)}`);
    await sleep(1000);
    const onReadBack = await localMqtt.getProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
    );
    console.log(`  读回: ${JSON.stringify(onReadBack)}\n`);

    // Wait
    console.log('等待 5 秒...\n');
    await sleep(5000);

    // Turn OFF
    console.log('>>> 关闭设备 (本地)...');
    const offResult = await localMqtt.setProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
      false,
    );
    console.log(`  结果: ${JSON.stringify(offResult)}`);
    await sleep(1000);
    const offReadBack = await localMqtt.getProp(
      TARGET_DID,
      TARGET_SIID,
      TARGET_PIID,
    );
    console.log(`  读回: ${JSON.stringify(offReadBack)}\n`);

    await localMqtt.disconnect();
  } catch (err) {
    console.error(`✗ 网关连接失败: ${(err as Error).message}`);
    console.error('\n  可能原因:');
    console.error('  1. 证书未被网关授权 — 尝试在米家 APP 中重新授权');
    console.error('  2. 路由器内置网关功能未启用 — 检查路由器管理页面');
    console.error('  3. 网关固件版本过低 — 需要固件 ≥ 3.3.0_0023');
    console.error('  4. 证书已过期 — 删除 .cache/cert/ 目录后重试');
  }

  console.log('完成。');
}

// Need join from path
import {join} from 'node:path';

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
