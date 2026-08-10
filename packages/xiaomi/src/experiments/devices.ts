import {chmodSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {BackendClient} from '../library/index.js';

import {CACHE_DIRECTORY, loadValidOAuthSession} from './session.js';

const DEVICE_SNAPSHOT_PATH = join(CACHE_DIRECTORY, 'device-snapshot.json');

async function main(): Promise<void> {
  const session = await loadValidOAuthSession();
  const backendClient = new BackendClient({
    uuid: session.uuid,
    accessToken: session.token.accessToken,
    cloudServer: session.cloudServer,
  });
  const discovery = await backendClient.discoverDevices();
  const snapshot = {
    capturedAt: new Date().toISOString(),
    cloudServer: session.cloudServer,
    ...discovery,
  };

  writeFileSync(DEVICE_SNAPSHOT_PATH, JSON.stringify(snapshot, undefined, 2), {
    mode: 0o600,
  });
  chmodSync(DEVICE_SNAPSHOT_PATH, 0o600);

  console.info(
    `Discovered ${snapshot.devices.length} devices in ${snapshot.homes.length} homes.`,
  );

  for (const device of snapshot.devices) {
    const location = [device.homeName, device.roomName]
      .filter(value => value !== undefined && value !== '')
      .join(' / ');
    let status: string;

    if (device.online === undefined) {
      status = 'unknown';
    } else if (device.online) {
      status = 'online';
    } else {
      status = 'offline';
    }

    console.info(
      [
        location === '' ? '(unassigned)' : location,
        device.name ?? '(unnamed)',
        device.model ?? '(unknown model)',
        device.specType ?? '(no spec)',
        device.did,
        status,
      ].join(' | '),
    );
  }

  console.info(`Snapshot saved to ${DEVICE_SNAPSHOT_PATH}.`);
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
