/**
 * Xiaomi MIoT experiment entry point.
 *
 * This script walks through the full flow:
 *  1. OAuth2 login — generate auth URL, start a local HTTP server to receive
 *     the redirect callback, exchange the code for tokens.
 *  2. Fetch user info (nickname).
 *  3. List all homes and devices.
 *  4. Connect to the cloud MQTT broker and subscribe to property changes.
 *  5. Find a light device and toggle its on/off property.
 *
 * Usage:
 *   npx tsx packages/xiaomi/src/experiments/control-light.ts
 *
 * Or after build:
 *   node packages/xiaomi/bld/experiments/control-light.js
 */

import {createServer, type Server} from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  XiaomiOAuthClient,
  generateUuid,
  type AuthInfo,
} from '../library/oauth-client.js';
import {XiaomiHttpClient, type DeviceInfo} from '../library/http-client.js';
import {XiaomiMqttCloudClient} from '../library/mqtt-client.js';
import {OAUTH2_CLIENT_ID, type CloudServer} from '../library/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');
const AUTH_CACHE = join(CACHE_DIR, 'auth-info.json');
const UUID_CACHE = join(CACHE_DIR, 'uuid.txt');

const REDIRECT_PORT = 8123;
const REDIRECT_HOST = 'homeassistant.local';
const REDIRECT_URL = `http://${REDIRECT_HOST}:${REDIRECT_PORT}`;

interface ExperimentOptions {
  cloudServer?: CloudServer;
  /** Skip OAuth if cached tokens are still valid. */
  useCache?: boolean;
}

async function main(): Promise<void> {
  const cloudServer: CloudServer = 'cn';
  const useCache = true;

  console.log('=== Xiaomi MIoT Experiment ===\n');

  // Step 1: OAuth2 login
  const authInfo = await ensureAuth(cloudServer, useCache);

  // Step 2: Create HTTP client and fetch user info
  const http = new XiaomiHttpClient({
    cloudServer,
    clientId: OAUTH2_CLIENT_ID,
    accessToken: authInfo.access_token,
  });

  try {
    const userInfo = await http.getUserInfo();
    console.log(`✓ Logged in as: ${userInfo.miliaoNick}\n`);
  } catch (err) {
    console.warn(`! Could not fetch user info: ${(err as Error).message}\n`);
  }

  // Step 3: Get devices
  console.log('Fetching device list...');
  const devicesResult = await http.getDevices();
  console.log(
    `✓ Found ${Object.keys(devicesResult.devices).length} device(s)\n`,
  );

  // Print homes
  for (const [source, homes] of Object.entries(devicesResult.homes)) {
    if (Object.keys(homes).length === 0) continue;
    console.log(`Homes (${source}):`);
    for (const [homeId, homeInfo] of Object.entries(
      homes as Record<string, any>,
    )) {
      console.log(`  - [${homeId}] ${homeInfo.home_name}`);
    }
  }
  console.log();

  // Print devices
  console.log('Devices:');
  for (const device of Object.values(devicesResult.devices)) {
    console.log(
      `  - ${device.name} (${device.did})`,
      `model=${device.model}`,
      `online=${device.online}`,
    );
  }
  console.log();

  // Step 4: Connect to MQTT cloud broker
  const uuid = loadOrCreateUuid();
  console.log('Connecting to MQTT cloud broker...');
  const mqtt = new XiaomiMqttCloudClient({
    uuid,
    cloudServer,
    appId: OAUTH2_CLIENT_ID,
    token: authInfo.access_token,
  });

  try {
    await mqtt.connect();
    console.log('✓ MQTT connected\n');

    // Subscribe to all device property changes
    for (const device of Object.values(devicesResult.devices)) {
      mqtt.subProp(
        device.did,
        (params, ctx) => {
          console.log(
            `  [MQTT] prop changed: ${ctx as string} ->`,
            JSON.stringify(params),
          );
        },
        `${device.did} (${device.name})`,
      );
    }
  } catch (err) {
    console.warn(`! MQTT connection failed: ${(err as Error).message}\n`);
  }

  // Step 5: Find a light and toggle it
  const light = findLight(devicesResult.devices);
  if (light) {
    console.log(`Found light: ${light.name} (${light.did})`);
    console.log(`  model: ${light.model}`);
    console.log(`  urn: ${light.urn}\n`);

    await toggleLight(http, light);
  } else {
    console.log('No light device found in your home. Trying any switch...');
    const switchDevice = findSwitch(devicesResult.devices);
    if (switchDevice) {
      console.log(`Found switch: ${switchDevice.name} (${switchDevice.did})`);
      await toggleLight(http, switchDevice);
    } else {
      console.log('No controllable device found.');
    }
  }

  // Keep listening for MQTT messages for a while
  console.log('\nListening for MQTT property changes for 30 seconds...');
  await sleep(30_000);

  // Cleanup
  console.log('\nDisconnecting...');
  await mqtt.disconnect();
  console.log('Done.');
}

// ---- Helper functions ----

async function ensureAuth(
  cloudServer: CloudServer,
  useCache: boolean,
): Promise<AuthInfo> {
  // Try loading cached auth info
  if (useCache && existsSync(AUTH_CACHE)) {
    const cached: AuthInfo = JSON.parse(readFileSync(AUTH_CACHE, 'utf-8'));
    if (cached.expires_ts > Math.floor(Date.now() / 1000) + 60) {
      console.log('✓ Using cached auth info (still valid)\n');
      return cached;
    }
    // Try refreshing
    console.log('Cached token expired, refreshing...');
    const uuid = loadOrCreateUuid();
    const oauth = new XiaomiOAuthClient({
      cloudServer,
      uuid,
      redirectUrl: REDIRECT_URL,
    });
    try {
      const refreshed = await oauth.refreshAccessToken(cached.refresh_token);
      saveAuth(refreshed);
      console.log('✓ Token refreshed\n');
      return refreshed;
    } catch (err) {
      console.warn(
        `! Token refresh failed: ${(err as Error).message}, re-login...\n`,
      );
    }
  }

  // Full OAuth flow
  const uuid = loadOrCreateUuid();
  const oauth = new XiaomiOAuthClient({
    cloudServer,
    uuid,
    redirectUrl: REDIRECT_URL,
  });

  const authUrl = oauth.genAuthUrl();
  console.log('Please open this URL in your browser to login:\n');
  console.log(authUrl);
  console.log('\nWaiting for OAuth callback...\n');

  const code = await waitForOAuthCallback(REDIRECT_PORT);
  console.log('✓ Received OAuth code\n');

  const authInfo = await oauth.getAccessToken(code);
  saveAuth(authInfo);
  console.log('✓ Got access token\n');

  return authInfo;
}

function waitForOAuthCallback(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (code) {
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
            '<h1>✅ Login successful!</h1>' +
            '<p>You can close this tab and return to the terminal.</p>' +
            '</body></html>',
        );
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Missing code parameter');
      }
    });

    server.on('error', reject);
    server.listen(port, () => {
      console.log(
        `OAuth callback server listening on http://localhost:${port}`,
      );
      console.log(`Note: the redirect URL is set to ${REDIRECT_URL}.`);
      console.log(
        'If your browser cannot reach that host, manually copy the ' +
          "'code' parameter from the redirect URL after login.\n",
      );
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error('OAuth callback timed out (5 minutes)'));
      },
      5 * 60 * 1000,
    );
  });
}

function loadOrCreateUuid(): string {
  mkdirSync(CACHE_DIR, {recursive: true});
  if (existsSync(UUID_CACHE)) {
    return readFileSync(UUID_CACHE, 'utf-8').trim();
  }
  const uuid = generateUuid();
  writeFileSync(UUID_CACHE, uuid);
  return uuid;
}

function saveAuth(authInfo: AuthInfo): void {
  mkdirSync(CACHE_DIR, {recursive: true});
  writeFileSync(AUTH_CACHE, JSON.stringify(authInfo, null, 2));
}

/** Find a light device by model name pattern. */
function findLight(
  devices: Record<string, DeviceInfo>,
): DeviceInfo | undefined {
  for (const device of Object.values(devices)) {
    const model = device.model.toLowerCase();
    if (
      model.includes('light') ||
      model.includes('lamp') ||
      model.includes('bulb') ||
      model.includes('ceil') ||
      model.includes('magnet') ||
      model.includes('light.')
    ) {
      return device;
    }
  }
  return undefined;
}

/** Find a switch or plug device as fallback. */
function findSwitch(
  devices: Record<string, DeviceInfo>,
): DeviceInfo | undefined {
  for (const device of Object.values(devices)) {
    const model = device.model.toLowerCase();
    if (
      model.includes('plug') ||
      model.includes('switch') ||
      model.includes('outlet') ||
      model.includes('ctrl')
    ) {
      return device;
    }
  }
  return undefined;
}

/**
 * Toggle a light/switch device.
 *
 * For most Xiaomi lights and switches, the on/off property is at
 * siid=2, piid=1 (the `switch` service). We read the current value,
 * then set it to the opposite.
 */
async function toggleLight(
  http: XiaomiHttpClient,
  device: DeviceInfo,
): Promise<void> {
  const siid = 2;
  const piid = 1;

  console.log(`Reading current state (siid=${siid}, piid=${piid})...`);
  try {
    const currentValue = await http.getProp(device.did, siid, piid);
    console.log(`  Current value: ${JSON.stringify(currentValue)}`);

    const newValue = !currentValue;
    console.log(`Setting to: ${JSON.stringify(newValue)}...`);
    const result = await http.setProp(device.did, siid, piid, newValue);
    console.log(`  Result: ${JSON.stringify(result)}`);

    // Read back
    await sleep(2000);
    const readBack = await http.getProp(device.did, siid, piid);
    console.log(`  Read back: ${JSON.stringify(readBack)}`);
  } catch (err) {
    console.error(`! Failed to control device: ${(err as Error).message}`);
    console.log(
      '\n  This device may use different siid/piid values.',
      'You can inspect the device spec at:',
    );
    console.log(`  https://miot-spec.org/spec/instance?type=${device.urn}`);
  }
  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Experiment failed:', err);
  process.exit(1);
});
