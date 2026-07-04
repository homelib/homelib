/**
 * Experiment: test whether the Xiaomi cloud MQTT broker allows
 * wildcard subscriptions to receive property changes from ALL devices.
 *
 * Subscribes to multiple topic filters simultaneously:
 *
 *   A) device/+/up/properties_changed/#   (wildcard did)
 *   B) device/+/up/#                      (all upstream messages)
 *   C) #                                  (everything)
 *
 * Also does per-device subscriptions for comparison.
 *
 * Every received message is printed with its topic and payload.
 */

import {join} from 'node:path';

import {type MqttClient, connect} from 'mqtt';

import {
  OAUTH2_CLIENT_ID,
  getBrokerHost,
  type CloudServer,
} from '../library/miot-exp/index.js';
import {
  CACHE_DIR,
  ensureAccessToken,
  loadOrCreateUuid,
  sleep,
} from './shared.js';

async function main(): Promise<void> {
  console.log('=== 实验: 云端 MQTT 通配订阅测试 ===\n');

  const cloudServer: CloudServer = 'cn';
  const {accessToken} = await ensureAccessToken(cloudServer);
  const uuid = loadOrCreateUuid();

  const host = getBrokerHost(cloudServer);
  console.log(`Broker: ${host}:8883`);
  console.log(`Client ID: ha.${uuid}`);
  console.log(`Username: ${OAUTH2_CLIENT_ID}`);
  console.log();

  // Connect directly with mqtt.js
  console.log('连接云端 MQTT broker...');
  const mqtt: MqttClient = connect(`mqtts://${host}:8883`, {
    clientId: `ha.${uuid}`,
    username: OAUTH2_CLIENT_ID,
    password: accessToken,
    keepalive: 300,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 10_000,
    connectTimeout: 30_000,
    rejectUnauthorized: false,
  });

  let msgCount = 0;
  const countsByFilter: Record<string, number> = {};

  mqtt.on('connect', () => {
    console.log('✓ MQTT 已连接\n');

    // --- Wildcard experiments ---
    const filters: Array<{label: string; topic: string}> = [
      {label: 'A', topic: 'device/+/up/properties_changed/#'},
      {label: 'B', topic: 'device/+/up/#'},
      {label: 'C', topic: '#'},
    ];

    console.log('订阅通配 topic:');
    for (const f of filters) {
      countsByFilter[f.label] = 0;
      mqtt.subscribe(f.topic, {qos: 2}, (err, granted) => {
        if (err) {
          console.log(`  ✗ 订阅失败 ${f.label} (${f.topic}): ${err.message}`);
        } else {
          const qosList = granted?.map(g => g.qos).join(',') ?? '?';
          console.log(`  ✓ ${f.label}: ${f.topic} -> granted QoS: ${qosList}`);
        }
      });
    }

    console.log();
  });

  mqtt.on('message', (topic, payload) => {
    msgCount++;
    const payloadStr = payload.toString('utf-8');
    const truncated =
      payloadStr.length > 500 ? payloadStr.slice(0, 500) + '...' : payloadStr;

    console.log(`\n[#${msgCount}] topic: ${topic}`);
    console.log(`  payload: ${truncated}`);
  });

  mqtt.on('error', err => {
    console.error('MQTT error:', err.message);
  });

  mqtt.on('close', () => {
    console.log('MQTT connection closed');
  });

  mqtt.on('disconnect', () => {
    console.log('MQTT disconnect packet received');
  });

  // Keep listening
  console.log('\n监听中 (60 秒)... 触发一些设备状态变化来测试是否能收到\n');
  await sleep(60_000);

  console.log(`\n--- 总结 ---`);
  console.log(`总计收到 ${msgCount} 条消息`);
  console.log('完成。');
  mqtt.end();
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
