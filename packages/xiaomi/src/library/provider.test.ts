import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {DehumidifierEndpoint, LightEndpoint} from '@homelib/core';

import {
  miotDehumidifierEndpointAdapter,
  miotLightEndpointAdapter,
} from './devices/index.js';
import {getMiotEndpointConnectionResourceKeys} from './endpoint-connection.js';
import type {MiotSpecInstance} from './miot/index.js';
import {$xiaomi, MiotProvider} from './provider.js';

const LIGHT_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  description: 'Test light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Light',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
  ],
};

const DEHUMIDIFIER_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:1',
  description: 'Test dehumidifier',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:dehumidifier:00007841:test:1',
      description: 'Dehumidifier',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
    {
      iid: 3,
      type: 'urn:miot-spec-v2:service:environment:0000780A:test:1',
      description: 'Environment',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:relative-humidity:0000000C:test:1',
          description: 'Relative Humidity',
          format: 'uint8',
          access: ['read', 'notify'],
          unit: 'percentage',
          'value-range': [0, 100, 1],
        },
        {
          iid: 2,
          type: 'urn:miot-spec-v2:property:temperature:00000020:test:1',
          description: 'Temperature',
          format: 'float',
          access: ['read', 'notify'],
          unit: 'celsius',
          'value-range': [-30, 100, 1],
        },
      ],
    },
  ],
};

test('rejects duplicate provider declarations', () => {
  $xiaomi('home');

  expect(() => $xiaomi('home')).toThrow('Duplicate provider: home.');
});

test('routes endpoint binding plans through the exact endpoint adapter', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const [candidate] = miotLightEndpointAdapter.findMetadataCandidates(
    {did: 'device', model: 'test.light'},
    LIGHT_SPEC,
  );

  if (candidate === undefined) {
    throw new Error('Test light has no MIoT metadata candidate.');
  }

  const provider = new MiotProvider('provider');
  const plan = provider.createEndpointConnectionBindingPlan(
    new LightEndpoint(),
    candidate.metadata,
  );

  expect(plan.resourceKeys).toEqual(
    getMiotEndpointConnectionResourceKeys(candidate.metadata),
  );
  expect(() =>
    provider.createEndpointConnectionBindingPlan(
      new SpecializedLightEndpoint(),
      candidate.metadata,
    ),
  ).toThrow('Unsupported MIoT endpoint.');
});

test('claims every service used by a multi-service endpoint', () => {
  const [candidate] = miotDehumidifierEndpointAdapter.findMetadataCandidates(
    {did: 'dehumidifier', model: 'xiaomi.derh.13l'},
    DEHUMIDIFIER_SPEC,
  );

  if (candidate === undefined) {
    throw new Error('Test dehumidifier has no MIoT metadata candidate.');
  }

  const provider = new MiotProvider('provider');
  const plan = provider.createEndpointConnectionBindingPlan(
    new DehumidifierEndpoint(),
    candidate.metadata,
  );

  expect(plan.resourceKeys).toEqual([
    JSON.stringify(['dehumidifier', 2]),
    JSON.stringify(['dehumidifier', 3]),
  ]);
});

test('forgets the local session while preserving identity and configuration', async () => {
  const previousEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-miot-provider-test-'),
  );

  try {
    process.env.HOMELIB_DIRECTORY = environmentDirectory;

    const providerDirectory = join(environmentDirectory, 'providers', 'miot');
    const sessionPath = join(providerDirectory, 'home.json');
    const identityPath = join(providerDirectory, 'identity', 'home.json');
    const configurationPath = join(providerDirectory, 'config', 'home.json');

    await Promise.all([
      mkdir(join(providerDirectory, 'identity'), {recursive: true}),
      mkdir(join(providerDirectory, 'config'), {recursive: true}),
    ]);
    await Promise.all([
      writeFile(sessionPath, 'session'),
      writeFile(identityPath, 'identity'),
      writeFile(configurationPath, 'configuration'),
    ]);

    const provider = new MiotProvider('home');

    await provider.configuration.forgetAuthorization();
    await provider.configuration.forgetAuthorization();

    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(identityPath, 'utf8')).resolves.toBe('identity');
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe(
      'configuration',
    );
  } finally {
    if (previousEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = previousEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});
