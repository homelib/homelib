import {SetSwitchOnCommand, SwitchEndpoint} from '@homelib/core';
import {reaction} from 'mobx';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {MiotEndpointConnectionTransport} from '../endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
  type MiotSpecService,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotSwitchEndpointConnection} from './switch.js';

test('matches the verified xiaomi.switch.w1 layout', () => {
  const spec = createSpec();
  const resources = resolveMiotEndpointConnectionResources(
    MiotSwitchEndpointConnection,
    spec,
  );

  expect(MiotSwitchEndpointConnection.Endpoint).toBe(SwitchEndpoint);
  expect(resources).toMatchObject([
    {
      service: {iid: 2},
      properties: {on: {iid: 1}},
    },
  ]);
});

test('does not match an unverified device revision', () => {
  const spec = {
    ...createSpec(),
    type: 'urn:miot-spec-v2:device:switch:0000A003:xiaomi-w1:3:0000C808',
  };

  expect(
    resolveMiotEndpointConnectionResources(MiotSwitchEndpointConnection, spec),
  ).toBeUndefined();
});

test('does not guess the relay property IID', () => {
  const spec = createSpec();
  const [property] = spec.services[0]?.properties ?? [];

  if (property === undefined) {
    throw new Error('Missing test switch property.');
  }

  property.iid = 2;

  expect(
    resolveMiotEndpointConnectionResources(MiotSwitchEndpointConnection, spec),
  ).toBeUndefined();
});

test('fails closed with an ambiguous switch service', () => {
  const spec = createSpec();
  const [service] = spec.services;

  if (service === undefined) {
    throw new Error('Missing test switch service.');
  }

  spec.services.push({...service, iid: 3});

  expect(
    resolveMiotEndpointConnectionResources(MiotSwitchEndpointConnection, spec),
  ).toBeUndefined();
});

test('projects state and writes the relay on property', async () => {
  const transport = new TestTransport();
  const connection = createConnection(transport);
  const [property] = connection.snapshotProperties;

  if (property === undefined) {
    throw new Error('Missing test switch state property.');
  }

  const observedOnValues: boolean[] = [];
  const disposeReaction = reaction(
    () => connection.on,
    value => observedOnValues.push(value),
    {fireImmediately: true},
  );

  expect(connection.notificationTargets).toEqual([
    {type: 'property-change', data: property},
  ]);
  expect(connection.on).toBe(false);

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [{...property, value: true}],
  });
  expect(connection.on).toBe(true);

  connection.handleSnapshotInvalidation([property]);
  expect(connection.on).toBe(true);
  expect(connection.getCommandEffectState('on')).toBeUndefined();
  expect(observedOnValues).toEqual([false, true]);

  const execution = connection.prepareCommand(new SetSwitchOnCommand(false));
  expect(execution.toLogString?.()).toBe('set on=false');
  await execution.execute();

  expect(transport.requests).toEqual([
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 2, piid: 1},
      false,
    ),
  ]);
  disposeReaction();
});

function createConnection(
  transport: TestTransport,
): MiotSwitchEndpointConnection {
  const spec = createSpec();
  const persistedMetadata = createMiotEndpointConnectionMetadata(
    {did: 'switch-1', model: 'xiaomi.switch.w1'},
    spec,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotSwitchEndpointConnection,
    persistedMetadata,
    spec,
  );

  return new MiotSwitchEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );
}

function createSpec(): MiotSpecInstance {
  return {
    type: 'urn:miot-spec-v2:device:switch:0000A003:xiaomi-w1:2:0000C808',
    description: 'Switch',
    services: [createSwitchService()],
  };
}

function createSwitchService(): MiotSpecService {
  return {
    iid: 2,
    type: 'urn:miot-spec-v2:service:switch:0000780C:xiaomi-w1:1:0000C808',
    description: 'Switch',
    properties: [createOnProperty()],
  };
}

function createOnProperty(): MiotSpecProperty {
  return {
    iid: 1,
    type: 'urn:miot-spec-v2:property:on:00000006:xiaomi-w1:1:0000C808',
    description: 'Switch Status',
    format: 'bool',
    access: ['read', 'write', 'notify'],
  };
}

class TestTransport extends MiotEndpointConnectionTransport {
  readonly requests: MiotExecutionRequest[] = [];

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    this.requests.push(request);
    return {code: 0};
  }
}
