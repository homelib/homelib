import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import * as x from 'x-value';

import {
  BackendClient,
  MiotLightEndpointConnection,
  MiotSetPropertyRequest,
  MiotSpecClient,
  findMiotEndpointMatches,
  isSuccessfulMiotExecutionResult,
} from '../library/index.js';

import {CACHE_DIRECTORY, loadValidOAuthSession} from './session.js';

const DEFAULT_DEVICE_ID = 'group.2025748340096892928';
const DEVICE_SNAPSHOT_PATH = join(CACHE_DIRECTORY, 'device-snapshot.json');

const DeviceSnapshotValue = x.object({
  devices: x.array(
    x.object({
      did: x.string,
      name: x.string.optional(),
      specType: x.string.optional(),
    }),
  ),
});

async function main(): Promise<void> {
  const deviceId = process.argv[2] ?? DEFAULT_DEVICE_ID;
  const snapshot = DeviceSnapshotValue.satisfies(
    JSON.parse(readFileSync(DEVICE_SNAPSHOT_PATH, 'utf8')),
  );
  const device = snapshot.devices.find(({did}) => did === deviceId);

  if (device === undefined) {
    throw new Error(`Device ${deviceId} is missing from the snapshot.`);
  } else if (device.specType === undefined) {
    throw new Error(`Device ${deviceId} has no spec type.`);
  }

  const spec = await new MiotSpecClient().getInstance(device.specType);
  const matches = MiotLightEndpointConnection.endpointProfiles.flatMap(
    ({services}) =>
      services.flatMap(matcher => findMiotEndpointMatches(spec, matcher)),
  );

  if (matches.length !== 1) {
    throw new Error(`Expected one light endpoint, received ${matches.length}.`);
  }

  const [match] = matches;

  if (match === undefined) {
    throw new Error('Matched light endpoint is missing.');
  }

  const session = await loadValidOAuthSession();
  const backendClient = new BackendClient({
    uuid: session.uuid,
    accessToken: session.token.accessToken,
    cloudServer: session.cloudServer,
  });
  const property = {
    did: deviceId,
    siid: match.service.iid,
    piid: match.properties.on.iid,
  };
  const [getResult] = await backendClient.getProperties([property]);

  if (getResult === undefined) {
    throw new Error('Cloud returned no light property result.');
  } else if (getResult.code !== 0) {
    throw new Error(`Cloud returned light property error ${getResult.code}.`);
  } else if (typeof getResult.value !== 'boolean') {
    throw new Error('Cloud returned a non-boolean light state.');
  }

  const [setResult] = await backendClient.setProperties([
    new MiotSetPropertyRequest(property, true),
  ]);

  if (setResult === undefined) {
    throw new Error('Cloud returned no light set result.');
  } else if (!isSuccessfulMiotExecutionResult(setResult)) {
    throw new Error(`Cloud returned light set error ${setResult.code}.`);
  }

  console.info({
    device: device.name ?? deviceId,
    service: match.service.iid,
    property: match.properties.on.iid,
    previousOn: getResult.value,
    requestedOn: true,
    setCode: setResult.code,
  });
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
