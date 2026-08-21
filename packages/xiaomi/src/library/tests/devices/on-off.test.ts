import {
  AirConditionerEndpoint,
  type Command,
  type CommandEffect,
  type CommandExecution,
  DehumidifierEndpoint,
  type EndpointReference,
  FanEndpoint,
  SetAirConditionerOnCommand,
  SetDehumidifierOnCommand,
  SetFanOnCommand,
} from '@homelib/core';
import {autorun} from 'mobx';

import {
  type MiotEndpointConnectionConstructor,
  createMiotDeviceEndpointConnectionBinding,
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../../device.js';
import {MiotAirConditionerEndpointConnection} from '../../devices/air-conditioner.js';
import {MiotDehumidifierEndpointConnection} from '../../devices/dehumidifier.js';
import {MiotFanEndpointConnection} from '../../devices/fan.js';
import {
  type MiotEndpointConnectionIdentityMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  type MiotPropertyUpdate,
} from '../../endpoint-connection/index.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
} from '../../miot/index.js';
import {MiotProvider} from '../../provider.js';

defineOnOffEndpointTests<MiotAirConditionerEndpointConnection>({
  name: 'air conditioner',
  deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004',
  serviceType: 'urn:miot-spec-v2:service:air-conditioner:0000780F',
  Endpoint: AirConditionerEndpoint,
  Connection: MiotAirConditionerEndpointConnection,
  createEndpoint: () => new AirConditionerEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    ),
  setOn: async (connection, value) => {
    return requireEffect(
      await executeCommand(connection, new SetAirConditionerOnCommand(value)),
    );
  },
});

defineOnOffEndpointTests<MiotDehumidifierEndpointConnection>({
  name: 'dehumidifier',
  deviceType: 'urn:miot-spec-v2:device:dehumidifier:0000A02D',
  serviceType: 'urn:miot-spec-v2:service:dehumidifier:00007841',
  Endpoint: DehumidifierEndpoint,
  Connection: MiotDehumidifierEndpointConnection,
  createEndpoint: () => new DehumidifierEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    ),
  setOn: async (connection, value) => {
    return requireEffect(
      await executeCommand(connection, new SetDehumidifierOnCommand(value)),
    );
  },
});

defineOnOffEndpointTests<MiotFanEndpointConnection>({
  name: 'fan',
  deviceType: 'urn:miot-spec-v2:device:fan:0000A005',
  serviceType: 'urn:miot-spec-v2:service:fan:00007808',
  Endpoint: FanEndpoint,
  Connection: MiotFanEndpointConnection,
  createEndpoint: () => new FanEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotFanEndpointConnection(new MiotProvider('provider'), metadata, [
      transport,
    ]),
  setOn: async (connection, value) => {
    return requireEffect(
      await executeCommand(connection, new SetFanOnCommand(value)),
    );
  },
});

type OnOffConnection = {
  readonly on: boolean;
  readonly stateProperties: readonly MiotProperty[];
  readonly handlePropertyUpdate: (update: MiotPropertyUpdate) => void;
  readonly handleStateUpdate: (update: {
    readonly did: string;
    readonly online: boolean;
    readonly properties: readonly MiotPropertyUpdate[];
  }) => void;
};

type OnOffEndpoint<TConnection extends OnOffConnection> = EndpointReference & {
  readonly on: boolean;
  readonly bindConnection: (connection: TConnection | undefined) => void;
};

type OnOffEndpointTestOptions<TConnection extends OnOffConnection> = {
  readonly name: string;
  readonly deviceType: string;
  readonly serviceType: string;
  readonly Endpoint: unknown;
  readonly Connection: MiotEndpointConnectionConstructor;
  readonly createEndpoint: () => OnOffEndpoint<TConnection>;
  readonly createConnection: (
    metadata: MiotEndpointConnectionResolvedMetadata,
    transport: TestTransport,
  ) => TConnection;
  readonly setOn: (
    connection: TConnection,
    value: boolean,
  ) => Promise<CommandEffect>;
};

function defineOnOffEndpointTests<TConnection extends OnOffConnection>(
  options: OnOffEndpointTestOptions<TConnection>,
): void {
  describe(`MIoT ${options.name} endpoint`, () => {
    test('matches the concrete device service and exposes its connection', () => {
      const spec = createSpec(options);
      const metadata = findPersistedMetadata(
        options.Connection,
        spec,
        options.name,
      );

      expect(options.Connection.Endpoint).toBe(options.Endpoint);
      expect(metadata).toMatchObject({
        version: 1,
        device: {did: 'device-1', urn: spec.type},
      });
      expect(metadata).not.toHaveProperty('resources');
      const resolvedMetadata = resolveMiotEndpointConnectionMetadata(
        options.Connection,
        metadata,
        spec,
      );
      expect(resolvedMetadata.resources).toMatchObject([{service: {iid: 2}}]);
      const binding = createMiotDeviceEndpointConnectionBinding(
        options.Connection,
        new MiotProvider('provider'),
        options.createEndpoint(),
        resolvedMetadata,
        [new TestTransport()],
      );

      expect(binding.connection).toBeInstanceOf(options.Connection);
    });

    test('matches the service contract on another device type', () => {
      const spec = {
        ...createSpec(options),
        type: 'urn:miot-spec-v2:device:other:0000FFFF:test:1',
      };

      const metadata = findPersistedMetadata(
        options.Connection,
        spec,
        options.name,
      );

      expect(metadata.device.urn).toBe(spec.type);
    });

    test('persists and resolves the deterministic property mapping', () => {
      const spec = createSpec(options);
      const metadata = findPersistedMetadata(
        options.Connection,
        spec,
        options.name,
      );
      const resolvedMetadata = resolveMiotEndpointConnectionMetadata(
        options.Connection,
        metadata,
        spec,
      );

      expect(resolvedMetadata.resources[0]?.properties).toEqual({
        on: expect.objectContaining({iid: 1}),
      });
      const connection = options.createConnection(
        resolvedMetadata,
        new TestTransport(),
      );

      expect(connection.stateProperties).toEqual([
        {did: metadata.device.did, siid: 2, piid: 1},
      ]);
    });

    test('fails closed with multiple relevant services', () => {
      const spec = createSpec(options);
      const service = spec.services.at(0);

      if (service === undefined) {
        throw new Error('Test spec has no service.');
      }

      spec.services.push({...service, iid: 3});

      expect(
        resolveMiotEndpointConnectionResources(options.Connection, spec),
      ).toBeUndefined();
    });

    test('translates on commands to MIoT property requests', async () => {
      const metadata = createMetadata(options);
      const transport = new TestTransport();
      const connection = options.createConnection(metadata, transport);

      await options.setOn(connection, true);
      await options.setOn(connection, false);

      expect(transport.requests).toEqual([
        new MiotSetPropertyRequest(
          {did: metadata.device.did, siid: 2, piid: 1},
          true,
        ),
        new MiotSetPropertyRequest(
          {did: metadata.device.did, siid: 2, piid: 1},
          false,
        ),
      ]);
    });

    test('returns an on effect that follows observed endpoint state', async () => {
      const metadata = createMetadata(options);
      const transport = new TestTransport();
      const connection = options.createConnection(metadata, transport);
      const endpoint = options.createEndpoint();
      endpoint.bindConnection(connection);
      const [property] = connection.stateProperties;

      if (property === undefined) {
        throw new Error('Test connection has no state property.');
      }

      connection.handleStateUpdate({
        did: metadata.device.did,
        online: true,
        properties: [{...property, value: true}],
      });
      const effect = await options.setOn(connection, true);
      const equivalentEffect = await options.setOn(connection, true);
      const differentEffect = await options.setOn(connection, false);

      expect(effect.equals(equivalentEffect)).toBe(true);
      expect(effect.equals(differentEffect)).toBe(false);
      expect(effect.matches(endpoint)).toBe(true);

      connection.handlePropertyUpdate({...property, value: false});
      expect(effect.matches(endpoint)).toBe(false);
    });

    test('projects MIoT property updates to observable on state', () => {
      const metadata = createMetadata(options);
      const connection = options.createConnection(
        metadata,
        new TestTransport(),
      );
      const values: boolean[] = [];
      const disposeAutorun = autorun(() => {
        values.push(connection.on);
      });
      const [property] = connection.stateProperties;

      if (property === undefined) {
        throw new Error('Test connection has no state property.');
      }

      connection.handlePropertyUpdate({...property, value: true});
      connection.handlePropertyUpdate({...property, value: false});

      expect(values).toEqual([false, true, false]);
      disposeAutorun();
    });
  });
}

function requireEffect(effect: CommandEffect | undefined): CommandEffect {
  if (effect === undefined) {
    throw new Error('MIoT stateful command returned no effect.');
  }

  return effect;
}

async function executeCommand<TCommand extends Command>(
  connection: {prepareCommand(command: TCommand): CommandExecution},
  command: TCommand,
): Promise<CommandEffect | undefined> {
  const execution = connection.prepareCommand(command);
  await execution.execute();
  return execution.effect;
}

function createMetadata(
  options: Pick<
    OnOffEndpointTestOptions<OnOffConnection>,
    'Connection' | 'deviceType' | 'name' | 'serviceType'
  >,
): MiotEndpointConnectionResolvedMetadata {
  const spec = createSpec(options);
  const metadata = findPersistedMetadata(
    options.Connection,
    spec,
    options.name,
  );

  return resolveMiotEndpointConnectionMetadata(
    options.Connection,
    metadata,
    spec,
  );
}

function findPersistedMetadata(
  Connection: MiotEndpointConnectionConstructor,
  spec: MiotSpecInstance,
  name: string,
): MiotEndpointConnectionIdentityMetadata {
  const resources = resolveMiotEndpointConnectionResources(Connection, spec);

  if (resources === undefined) {
    throw new Error('Test connection did not resolve endpoint resources.');
  }

  return createMiotEndpointConnectionMetadata(
    {did: 'device-1', model: `test.${name}`},
    spec,
  );
}

function createSpec(
  options: Pick<
    OnOffEndpointTestOptions<OnOffConnection>,
    'deviceType' | 'name' | 'serviceType'
  >,
): MiotSpecInstance {
  const vendorName = options.name.replaceAll(' ', '-');

  return {
    type: `${options.deviceType}:${vendorName}:1`,
    description: options.name,
    services: [
      {
        iid: 2,
        type: `${options.serviceType}:${vendorName}:1`,
        description: options.name,
        properties: [
          {
            iid: 1,
            type: `urn:miot-spec-v2:property:on:00000006:${vendorName}:1`,
            description: 'Switch Status',
            format: 'bool',
            access: ['read', 'write', 'notify'],
          },
        ],
      },
    ],
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
