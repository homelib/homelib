/**
 * Quick test: LAN direct control of the 大灯 (WiFi device).
 */

import {XiaomiLanClient} from '../library/miot-exp/index.js';

async function main(): Promise<void> {
  const lan = new XiaomiLanClient({
    did: '358499433',
    token: '19f9532d44f64c45e7d6953647fd493e',
    ip: '192.168.31.115',
  });

  await lan.init();
  console.log('UDP socket ready');

  console.log('Probing device...');
  const probed = await lan.probe(5000);
  if (!probed) {
    console.log('Device did not respond');
    await lan.close();
    return;
  }
  console.log('Device responded');

  // Subscribe to device (required before API calls)
  console.log('Subscribing to device...');
  const subscribed = await lan.subscribe(5000);
  console.log('  Subscribed:', subscribed);

  // Read current state
  console.log('Reading current state (siid=2, piid=1)...');
  const currentValue = await lan.getProp('358499433', 2, 1);
  console.log('  Current value:', JSON.stringify(currentValue));

  // Turn ON
  console.log('>>> Turning ON...');
  const onResult = await lan.setProp('358499433', 2, 1, true);
  console.log('  Result:', JSON.stringify(onResult));

  await new Promise(r => setTimeout(r, 1000));
  const onReadBack = await lan.getProp('358499433', 2, 1);
  console.log('  Read back:', JSON.stringify(onReadBack));

  // Wait
  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  // Turn OFF
  console.log('>>> Turning OFF...');
  const offResult = await lan.setProp('358499433', 2, 1, false);
  console.log('  Result:', JSON.stringify(offResult));

  await new Promise(r => setTimeout(r, 1000));
  const offReadBack = await lan.getProp('358499433', 2, 1);
  console.log('  Read back:', JSON.stringify(offReadBack));

  await lan.close();
  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
