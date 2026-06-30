/**
 * Quick test: LAN direct control of the fan (dmaker.fan.p5c).
 */

import { XiaomiLanClient } from '../library/lan-client.js';

async function main(): Promise<void> {
  const lan = new XiaomiLanClient({
    did: '965470798',
    token: 'e564f9d92551357cf99fed35d3fdca3c',
    ip: '192.168.31.183',
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

  // Subscribe
  console.log('Subscribing...');
  await lan.subscribe(5000);

  // Probe fan spec: siid=2 is usually the fan service, piid=1 is power
  // Let's probe a few properties first
  console.log('Probing properties...');
  for (let siid = 1; siid <= 4; siid++) {
    for (let piid = 1; piid <= 3; piid++) {
      try {
        const value = await lan.getProp('965470798', siid, piid, 5000);
        if (value !== null && value !== undefined) {
          console.log(`  siid=${siid}, piid=${piid}: ${JSON.stringify(value)}`);
        }
      } catch {
        // skip
      }
    }
  }

  // Try to turn on the fan (siid=2, piid=1 is typically the switch)
  console.log('\n>>> Turning ON fan (siid=2, piid=1)...');
  const onResult = await lan.setProp('965470798', 2, 1, true, 5000);
  console.log('  Result:', JSON.stringify(onResult));

  await new Promise(r => setTimeout(r, 1000));
  const onReadBack = await lan.getProp('965470798', 2, 1, 5000);
  console.log('  Read back:', JSON.stringify(onReadBack));

  // Wait
  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  // Turn off
  console.log('>>> Turning OFF fan...');
  const offResult = await lan.setProp('965470798', 2, 1, false, 5000);
  console.log('  Result:', JSON.stringify(offResult));

  await new Promise(r => setTimeout(r, 1000));
  const offReadBack = await lan.getProp('965470798', 2, 1, 5000);
  console.log('  Read back:', JSON.stringify(offReadBack));

  await lan.close();
  console.log('Done.');
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });