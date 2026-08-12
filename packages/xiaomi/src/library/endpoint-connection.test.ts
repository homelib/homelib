import {
  DeviceEntry,
  type EndpointConnection,
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  SetLightOnCommand,
} from '@homelib/core';
import {autorun} from 'mobx';

import {
  CloudDeviceChannel,
  type CloudDeviceMessageSource,
} from './cloud/device.js';
import type {CloudMqttDeviceMessageHandler} from './cloud/mqtt.js';
import type {MiotPlaceholderCommand} from './command.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {
  MiotEndpointConnectionMetadata,
  MiotEndpointConnectionTransport,
} from './endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
  findMiotEndpointMatches,
} from './miot/index.js';
import {MiotProvider} from './provider.js';

const TEST_METADATA = MiotEndpointConnectionMetadata.satisfies({
  device: {
    did: 'device-1',
    model: 'test.light',
    urn: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  },
  service: {
    iid: 2,
    type: 'urn:miot-spec-v2:service:light:00007802',
    description: 'Light',
    properties: [
      {
        iid: 1,
        type: 'urn:miot-spec-v2:property:on:00000006',
        description: 'Switch Status',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    ],
  },
  properties: {
    on: {
      iid: 1,
      type: 'urn:miot-spec-v2:property:on:00000006',
      description: 'Switch Status',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
});

test('declares the supported endpoint and MIoT matchers', () => {
  const spec: MiotSpecInstance = {
    type: TEST_METADATA.device.urn,
    description: 'Test light',
    services: [
      {
        ...TEST_METADATA.service,
        properties: Object.values(TEST_METADATA.properties),
      },
    ],
  };
  const matches = MiotLightEndpointConnection.endpointMatchers.flatMap(
    matcher => findMiotEndpointMatches(spec, matcher),
  );

  expect(MiotLightEndpointConnection.Endpoint).toBe(LightEndpoint);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.service.iid).toBe(TEST_METADATA.service.iid);
  expect(matches[0]?.properties.on.iid).toBe(TEST_METADATA.properties.on?.iid);
});

test('rejects light metadata without an on property', () => {
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    ...TEST_METADATA,
    properties: {},
  });

  expect(
    () =>
      new MiotLightEndpointConnection(new MiotProvider('provider'), metadata, [
        new TestTransport(),
      ]),
  ).toThrow('Invalid MIoT light endpoint metadata.');
});

test('rejects light metadata whose on property is not part of the service', () => {
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    ...TEST_METADATA,
    service: {...TEST_METADATA.service, properties: []},
  });

  expect(
    () =>
      new MiotLightEndpointConnection(new MiotProvider('provider'), metadata, [
        new TestTransport(),
      ]),
  ).toThrow('Invalid MIoT light endpoint metadata.');
});

test('rejects light metadata with an extra property alias', () => {
  const onProperty = TEST_METADATA.properties.on;

  if (onProperty === undefined) {
    throw new Error('Test light metadata has no on property.');
  }

  const metadata = MiotEndpointConnectionMetadata.satisfies({
    ...TEST_METADATA,
    properties: {on: onProperty, alias: onProperty},
  });

  expect(() => MiotLightEndpointConnection.assertMetadata(metadata)).toThrow(
    'Invalid MIoT light endpoint metadata.',
  );
});

test('rejects light metadata with duplicate property access values', () => {
  const onProperty = TEST_METADATA.properties.on;

  if (onProperty === undefined) {
    throw new Error('Test light metadata has no on property.');
  }

  const duplicateAccessProperty = {
    ...onProperty,
    access: [...onProperty.access, 'notify'],
  };
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    ...TEST_METADATA,
    service: {
      ...TEST_METADATA.service,
      properties: [duplicateAccessProperty],
    },
    properties: {on: duplicateAccessProperty},
  });

  expect(() => MiotLightEndpointConnection.assertMetadata(metadata)).toThrow(
    'Invalid MIoT light endpoint metadata.',
  );
});

test('translates light commands to MIoT requests', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [transport],
  );

  await connection.processCommand(new SetLightOnCommand(true));

  expect(transport.requests).toEqual([
    new MiotSetPropertyRequest(
      {
        did: TEST_METADATA.device.did,
        siid: TEST_METADATA.service.iid,
        piid: 1,
      },
      true,
    ),
  ]);
});

test('does not expose provider-wide commands', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [new TestTransport()],
  );

  // @ts-expect-error -- A light connection cannot process MIoT-only commands.
  const widenedConnection: EndpointConnection<
    LightEndpointCommand | MiotPlaceholderCommand
  > = connection;

  expect(widenedConnection).toBe(connection);
});

test('projects snapshot and MQTT updates to observable light state', async () => {
  const entry = new DeviceEntry('light');
  const light = entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Light endpoint was not created.');
  }

  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [new TestTransport()],
  );
  endpoint.bindConnection(connection);

  let messageHandler: CloudMqttDeviceMessageHandler | undefined;
  const messageSource: CloudDeviceMessageSource = {
    subscribeDevice: async (_did, handler) => {
      messageHandler = handler;
    },
    unsubscribeDevice: async _did => undefined,
  };
  const channel = new CloudDeviceChannel(
    TEST_METADATA.device.did,
    messageSource,
    async properties =>
      properties.map(property => ({...property, value: false, code: 0})),
    () => undefined,
  );
  const values: Array<boolean | undefined> = [];
  const disposeAutorun = autorun(() => {
    values.push(light.on);
  });
  const subscription = await channel.subscribe(connection.stateProperties, {
    onPropertyChanged: update => {
      connection.handlePropertyUpdate(update);
    },
  });

  const handler = messageHandler;

  if (handler === undefined) {
    throw new Error('Cloud MQTT handler was not registered.');
  }

  const [property] = connection.stateProperties;

  if (property === undefined) {
    throw new Error('MIoT light state property is missing.');
  }

  handler({...property, type: 'property', value: true});

  expect(values).toEqual([undefined, false, true]);

  disposeAutorun();
  await subscription.dispose();
});

class TestTransport extends MiotEndpointConnectionTransport {
  readonly requests: MiotExecutionRequest[] = [];

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    this.requests.push(request);
    return {code: 0};
  }
}
