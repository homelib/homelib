/**
 * Inspect a device's spec and properties.
 */

import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {XiaomiHttpClient} from '../library/http-client.js';
import {XiaomiOAuthClient, type AuthInfo} from '../library/oauth-client.js';
import {OAUTH2_CLIENT_ID, type CloudServer} from '../library/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');
const AUTH_CACHE = join(CACHE_DIR, 'auth-info.json');
const UUID_CACHE = join(CACHE_DIR, 'uuid.txt');

const TARGET_DID = '1110622389.s2';
const CLOUD_SERVER: CloudServer = 'cn';

async function main(): Promise<void> {
  const authInfo: AuthInfo = JSON.parse(readFileSync(AUTH_CACHE, 'utf-8'));
  const uuid = readFileSync(UUID_CACHE, 'utf-8').trim();

  let accessToken = authInfo.access_token;
  if (authInfo.expires_ts <= Math.floor(Date.now() / 1000) + 60) {
    const oauth = new XiaomiOAuthClient({
      cloudServer: CLOUD_SERVER,
      uuid,
      redirectUrl: 'http://homeassistant.local:8123',
    });
    const refreshed = await oauth.refreshAccessToken(authInfo.refresh_token);
    accessToken = refreshed.access_token;
  }

  const http = new XiaomiHttpClient({
    cloudServer: CLOUD_SERVER,
    clientId: OAUTH2_CLIENT_ID,
    accessToken,
  });

  // Get all devices to find the URN
  console.log('Fetching device list...');
  const devicesResult = await http.getDevices();
  const device = devicesResult.devices[TARGET_DID];

  if (!device) {
    // Try parent device (strip .s2)
    const parentDid = TARGET_DID.replace(/\.s\d+$/, '');
    const parent = devicesResult.devices[parentDid];
    if (parent) {
      console.log(`Parent device: ${parent.name} (${parent.did})`);
      console.log(`  model: ${parent.model}`);
      console.log(`  urn: ${parent.urn}`);
      console.log(`  sub_devices:`, Object.keys(parent.sub_devices ?? {}));

      if (parent.sub_devices) {
        for (const [subKey, subDev] of Object.entries(parent.sub_devices)) {
          console.log(`  sub ${subKey}: ${subDev.name} urn=${subDev.urn}`);
        }
      }
    }
    console.log();
  } else {
    console.log(`Device: ${device.name} (${device.did})`);
    console.log(`  model: ${device.model}`);
    console.log(`  urn: ${device.urn}`);
  }

  // Try fetching the spec from miot-spec.org
  const allDevices = Object.values(devicesResult.devices);
  for (const dev of allDevices) {
    if (
      dev.did === TARGET_DID ||
      dev.did === TARGET_DID.replace(/\.s\d+$/, '')
    ) {
      console.log(`\nFetching spec for: ${dev.urn}`);
      const specUrl = `https://miot-spec.org/miot-spec-v2/instance?type=${dev.urn}`;
      console.log(`  URL: ${specUrl}`);

      // Use fetch (Node 18+)
      try {
        const res = await fetch(specUrl);
        const text = await res.text();
        console.log(`  Response: ${text.slice(0, 2000)}`);
      } catch (err) {
        console.log(`  Fetch failed: ${(err as Error).message}`);
      }
    }

    // Check sub devices
    if (dev.sub_devices) {
      for (const sub of Object.values(dev.sub_devices)) {
        if (sub.did === TARGET_DID) {
          console.log(`\nFetching spec for sub-device: ${sub.urn}`);
          const specUrl = `https://miot-spec.org/miot-spec-v2/instance?type=${sub.urn}`;
          console.log(`  URL: ${specUrl}`);
          try {
            const res = await fetch(specUrl);
            const text = await res.text();
            console.log(`  Response: ${text.slice(0, 2000)}`);
          } catch (err) {
            console.log(`  Fetch failed: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  // Also try probing common siid/piid combinations
  console.log('\n--- Probing properties ---');
  for (let siid = 1; siid <= 6; siid++) {
    for (let piid = 1; piid <= 6; piid++) {
      try {
        const value = await http.getProp(TARGET_DID, siid, piid);
        if (value !== null && value !== undefined) {
          console.log(`  siid=${siid}, piid=${piid}: ${JSON.stringify(value)}`);
        }
      } catch {
        // skip
      }
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
