/**
 * Experiment: test whether the local hub gateway MQTT broker allows
 * wildcard subscriptions to receive property changes from ALL devices.
 *
 * We bypass the XiaomiLocalMqttClient wrapper and use mqtt.js directly,
 * subscribing to multiple topic filters simultaneously:
 *
 *   A) master/appMsg/notify/iot/+/property/#   (wildcard did)
 *   B) master/appMsg/notify/iot/#              (catch-all under iot)
 *   C) +#                                     (everything)
 *
 * Then we also do per-device subscriptions for comparison.
 *
 * Every received message is printed with its topic and (unpacked) payload.
 */

import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {type MqttClient, connect} from 'mqtt';

import {
  type GatewayInfo,
  OAUTH2_CLIENT_ID,
  XiaomiCertManager,
  XiaomiHttpClient,
  calcGroupId,
  discoverGatewaysWithFallback,
} from '../library/index.js';

import {
  CACHE_DIR,
  ensureAccessToken,
  loadOrCreateUuid,
  sleep,
} from './shared.js';

// Re-exported from local-mqtt-client for unpacking
function unpackMipsMessage(data: Buffer): {
  mid: number;
  retTopic?: string;
  payload?: string;
  msgFrom?: string;
} {
  let offset = 0;
  const result: {
    mid: number;
    retTopic?: string;
    payload?: string;
    msgFrom?: string;
  } = {mid: 0};

  while (offset < data.length) {
    if (offset + 5 > data.length) break;
    const len = data.readUInt32LE(offset);
    const type = data[offset + 4];
    const fieldData = data.subarray(offset + 5, offset + 5 + len);

    switch (type) {
      case 0:
        result.mid = fieldData.readUInt32LE(0);
        break;
      case 1:
        result.retTopic = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
      case 2:
        result.payload = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
      case 3:
        result.msgFrom = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
    }
    offset += 5 + len;
  }
  return result;
}

async function main(): Promise<void> {
  console.log('=== 实验: 本地网关通配订阅测试 ===\n');

  // 1. Auth + cloud device list (to find gateway DID)
  const {accessToken, uuid} = await ensureAccessToken('cn');
  const http = new XiaomiHttpClient({
    cloudServer: 'cn',
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  const devicesResult = await http.getDevices();
  const uid = devicesResult.uid;
  console.log(
    `UID: ${uid}, 设备数: ${Object.keys(devicesResult.devices).length}\n`,
  );

  // 2. Find gateway candidates
  const ownHomes = new Set(Object.keys(devicesResult.homes.home_list ?? {}));
  const candidates: Array<{
    did: string;
    name: string;
    model: string;
    homeId: string;
  }> = [];

  for (const [did, dev] of Object.entries(devicesResult.devices)) {
    if (!ownHomes.has(dev.home_id)) continue;
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
    console.error('✗ 没有找到候选网关设备');
    process.exit(1);
  }

  console.log('候选网关:');
  for (const c of candidates) {
    console.log(`  - ${c.name} did=${c.did} model=${c.model}`);
  }
  console.log();

  // 3. Discover gateway on local network
  console.log('发现局域网网关...');
  const candidateDids = candidates.map(c => c.did);
  const discovered = await discoverGatewaysWithFallback(candidateDids, 15_000);

  if (discovered.length === 0) {
    console.error('✗ 未在局域网发现网关');
    process.exit(1);
  }

  const gatewayHomeId =
    candidates.find(c => c.did === discovered[0]!.did)?.homeId ??
    candidates[0]!.homeId;
  const gateways: GatewayInfo[] = discovered.map(gw => {
    if (!gw.group_id) {
      gw.group_id = calcGroupId(uid, gatewayHomeId);
    }
    return gw;
  });

  const gateway = gateways[0]!;
  console.log(
    `✓ 网关: ${gateway.name} ${gateway.address}:${gateway.port} group_id=${gateway.group_id}\n`,
  );

  // 4. Ensure user certificate
  const certDir = join(CACHE_DIR, 'cert');
  const certManager = new XiaomiCertManager(certDir, uid, 'cn');
  const virtualDid = BigInt(`0x${uuid.slice(0, 16)}`).toString();

  console.log('检查证书...');
  await certManager.ensureUserCert(virtualDid, async (csr: string) => {
    console.log('  请求云端签发...');
    const cert = await http.getCentralCert(csr);
    console.log('  ✓ 签发成功');
    return cert;
  });
  console.log('✓ 证书就绪\n');

  // 5. Connect directly with mqtt.js — no wrapper
  console.log('连接网关 MQTT (mTLS)...');
  const ca = readFileSync(certManager.caPath);
  const cert = readFileSync(certManager.certPath);
  const key = readFileSync(certManager.keyPath);

  const mqtt: MqttClient = connect(
    `mqtts://${gateway.address}:${gateway.port}`,
    {
      clientId: virtualDid,
      protocolVersion: 5,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 10_000,
      connectTimeout: 10_000,
      rejectUnauthorized: false,
      ca,
      cert,
      key,
    },
  );

  let msgCount = 0;

  mqtt.on('connect', () => {
    console.log('✓ MQTT 已连接\n');

    // Subscribe to reply topic (needed for RPC responses like getDevList)
    mqtt.subscribe(`${virtualDid}/#`, {qos: 2});

    // Device list change
    mqtt.subscribe('master/appMsg/devListChange', {qos: 2});

    // --- Wildcard experiments ---
    // A: wildcard did in property topic
    const filterA = 'master/appMsg/notify/iot/+/property/#';
    // B: catch-all under iot
    const filterB = 'master/appMsg/notify/iot/#';
    // C: everything
    const filterC = '#';

    console.log('订阅通配 topic:');
    console.log(`  A: ${filterA}`);
    console.log(`  B: ${filterB}`);
    console.log(`  C: ${filterC}`);
    console.log();

    for (const f of [filterA, filterB, filterC]) {
      mqtt.subscribe(f, {qos: 2}, (err, granted) => {
        if (err) {
          console.log(`  ✗ 订阅失败 ${f}: ${err.message}`);
        } else {
          console.log(
            `  ✓ 订阅成功 ${f} -> granted: ${JSON.stringify(granted)}`,
          );
        }
      });
    }

    // Also subscribe per-device for comparison
    // First get the device list via RPC
    setTimeout(async () => {
      console.log('\n获取网关设备列表 (RPC)...');
      const mid = randomInt(0, 0xffffffff);
      const payload = JSON.stringify({});
      const mipsMsg = packMipsMessage(
        mid,
        payload,
        'local',
        `${virtualDid}/reply`,
      );
      mqtt.publish('master/proxy/getDevList', mipsMsg, {qos: 2});

      // Wait for reply, then subscribe per-device
      setTimeout(() => {
        // We'll also try subscribing to a few specific device property topics
        const testDids = Object.keys(devicesResult.devices).slice(0, 5);
        console.log(`\n同时逐设备订阅前 ${testDids.length} 个设备作为对照:`);
        for (const did of testDids) {
          const topic = `master/appMsg/notify/iot/${did}/property/#`;
          mqtt.subscribe(topic, {qos: 2}, err => {
            if (err) {
              console.log(`  ✗ ${topic}: ${err.message}`);
            } else {
              console.log(`  ✓ ${topic}`);
            }
          });
        }
      }, 3000);
    }, 2000);
  });

  mqtt.on('message', (topic, payload) => {
    msgCount++;
    // Try to unpack as MIPS binary message (local broker uses this format)
    let display: string;
    try {
      const mips = unpackMipsMessage(payload);
      if (mips.payload) {
        display = mips.payload;
      } else {
        // Not a MIPS message — show raw
        display = payload.toString('utf-8');
      }
    } catch {
      display = payload.toString('utf-8');
    }

    // Truncate long payloads for readability
    const truncated =
      display.length > 500 ? `${display.slice(0, 500)}...` : display;

    console.log(`\n[#${msgCount}] topic: ${topic}`);
    console.log(`  payload: ${truncated}`);
  });

  mqtt.on('error', err => {
    console.error('MQTT error:', err.message);
  });

  mqtt.on('close', () => {
    console.log('MQTT connection closed');
  });

  // Keep listening
  console.log('\n监听中 (60 秒)... 触发一些设备状态变化来测试是否能收到\n');
  await sleep(60_000);

  console.log(`\n总计收到 ${msgCount} 条消息`);
  mqtt.end();
  console.log('完成。');
}

// Minimal MIPS pack for getDevList request
function packMipsMessage(
  mid: number,
  payload: string,
  msgFrom?: string,
  retTopic?: string,
): Buffer {
  const parts: Buffer[] = [];

  // mid (type 0)
  parts.push(Buffer.from([4, 0, 0, 0, 0]));
  const midBuf = Buffer.alloc(4);
  midBuf.writeUInt32LE(mid, 0);
  parts.push(midBuf);

  if (msgFrom) {
    const data = Buffer.from(msgFrom, 'utf-8');
    const header = Buffer.alloc(5);
    header.writeUInt32LE(data.length + 1, 0);
    header[4] = 3;
    parts.push(header, data, Buffer.from([0]));
  }

  if (retTopic) {
    const data = Buffer.from(retTopic, 'utf-8');
    const header = Buffer.alloc(5);
    header.writeUInt32LE(data.length + 1, 0);
    header[4] = 1;
    parts.push(header, data, Buffer.from([0]));
  }

  const payloadData = Buffer.from(payload, 'utf-8');
  const payloadHeader = Buffer.alloc(5);
  payloadHeader.writeUInt32LE(payloadData.length + 1, 0);
  payloadHeader[4] = 2;
  parts.push(payloadHeader, payloadData, Buffer.from([0]));

  return Buffer.concat(parts);
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
