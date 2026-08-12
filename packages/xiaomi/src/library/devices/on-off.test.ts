import {
  AirConditionerEndpoint,
  DehumidifierEndpoint,
  type EndpointReference,
  FanEndpoint,
  SetAirConditionerOnCommand,
  SetDehumidifierOnCommand,
  SetFanOnCommand,
} from '@homelib/core';
import {autorun} from 'mobx';

import type {MiotEndpointAdapter} from '../endpoint-adapter.js';
import {
  MiotEndpointConnectionMetadata,
  MiotEndpointConnectionTransport,
  type MiotPropertyUpdate,
} from '../endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {
  MiotAirConditionerEndpointConnection,
  miotAirConditionerEndpointAdapter,
} from './air-conditioner.js';
import {
  MiotDehumidifierEndpointConnection,
  miotDehumidifierEndpointAdapter,
} from './dehumidifier.js';
import {MiotFanEndpointConnection, miotFanEndpointAdapter} from './fan.js';

defineOnOffEndpointTests({
  name: 'air conditioner',
  deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004',
  serviceType: 'urn:miot-spec-v2:service:air-conditioner:0000780F',
  Endpoint: AirConditionerEndpoint,
  Connection: MiotAirConditionerEndpointConnection,
  adapter: miotAirConditionerEndpointAdapter,
  createEndpoint: () => new AirConditionerEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    ),
  setOn: async (connection, value) => {
    await connection.processCommand(new SetAirConditionerOnCommand(value));
  },
});

defineOnOffEndpointTests({
  name: 'dehumidifier',
  deviceType: 'urn:miot-spec-v2:device:dehumidifier:0000A02D',
  serviceType: 'urn:miot-spec-v2:service:dehumidifier:00007841',
  Endpoint: DehumidifierEndpoint,
  Connection: MiotDehumidifierEndpointConnection,
  adapter: miotDehumidifierEndpointAdapter,
  createEndpoint: () => new DehumidifierEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    ),
  setOn: async (connection, value) => {
    await connection.processCommand(new SetDehumidifierOnCommand(value));
  },
});

defineOnOffEndpointTests({
  name: 'fan',
  deviceType: 'urn:miot-spec-v2:device:fan:0000A005',
  serviceType: 'urn:miot-spec-v2:service:fan:00007808',
  Endpoint: FanEndpoint,
  Connection: MiotFanEndpointConnection,
  adapter: miotFanEndpointAdapter,
  createEndpoint: () => new FanEndpoint(),
  createConnection: (metadata, transport) =>
    new MiotFanEndpointConnection(new MiotProvider('provider'), metadata, [
      transport,
    ]),
  setOn: async (connection, value) => {
    await connection.processCommand(new SetFanOnCommand(value));
  },
});

type OnOffConnection = {
  readonly on: boolean;
  readonly stateProperties: readonly MiotProperty[];
  readonly handlePropertyUpdate: (update: MiotPropertyUpdate) => void;
};

type OnOffEndpointTestOptions<TConnection extends OnOffConnection> = {
  readonly name: string;
  readonly deviceType: string;
  readonly serviceType: string;
  readonly Endpoint: unknown;
  readonly Connection: Function;
  readonly adapter: MiotEndpointAdapter;
  readonly createEndpoint: () => EndpointReference;
  readonly createConnection: (
    metadata: MiotEndpointConnectionMetadata,
    transport: TestTransport,
  ) => TConnection;
  readonly setOn: (connection: TConnection, value: boolean) => Promise<void>;
};

function defineOnOffEndpointTests<TConnection extends OnOffConnection>(
  options: OnOffEndpointTestOptions<TConnection>,
): void {
  describe(`MIoT ${options.name} endpoint`, () => {
    test('matches the concrete device service and exposes its adapter', () => {
      const spec = createSpec(options);
      const candidates = options.adapter.findMetadataCandidates(
        {did: 'device-1', model: `test.${options.name}`},
        spec,
      );

      expect(options.adapter.Endpoint).toBe(options.Endpoint);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        label: options.name,
        metadata: {
          device: {did: 'device-1', urn: spec.type},
          resources: [
            {
              service: {iid: 2},
              properties: {on: {iid: 1}},
            },
          ],
        },
      });

      const metadata = requireCandidateMetadata(candidates);
      const binding = options.adapter.createBinding(
        new MiotProvider('provider'),
        options.createEndpoint(),
        metadata,
        [new TestTransport()],
      );

      expect(binding.connection).toBeInstanceOf(options.Connection);
    });

    test('matches the service contract on another device type', () => {
      const spec = {
        ...createSpec(options),
        type: 'urn:miot-spec-v2:device:other:0000FFFF:test:1',
      };

      const candidates = options.adapter.findMetadataCandidates(
        {did: 'device-1', model: `test.${options.name}`},
        spec,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.metadata.device.urn).toBe(spec.type);
    });

    test('rejects metadata with an extra property alias', () => {
      const metadata = createMetadata(options);
      const [resource] = metadata.resources;

      if (resource === undefined) {
        throw new Error('Test metadata has no resource.');
      }
      const aliasProperty = {
        iid: 2,
        type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
        description: 'Mode',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        'value-list': [{value: 0, description: 'Default'}],
      };

      const invalidMetadata = MiotEndpointConnectionMetadata.satisfies({
        ...metadata,
        resources: [
          {
            ...resource,
            service: {
              ...resource.service,
              properties: [
                ...(resource.service.properties ?? []),
                aliasProperty,
              ],
            },
            properties: {
              ...resource.properties,
              alias: aliasProperty,
            },
          },
        ],
      });

      expect(() => options.adapter.assertMetadata(invalidMetadata)).toThrow(
        `Invalid MIoT ${options.name.replaceAll(' ', '-')} endpoint metadata.`,
      );
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

function createMetadata(
  options: Pick<
    OnOffEndpointTestOptions<OnOffConnection>,
    'adapter' | 'deviceType' | 'name' | 'serviceType'
  >,
): MiotEndpointConnectionMetadata {
  return requireCandidateMetadata(
    options.adapter.findMetadataCandidates(
      {did: 'device-1', model: `test.${options.name}`},
      createSpec(options),
    ),
  );
}

function requireCandidateMetadata(
  candidates: readonly {
    readonly metadata: MiotEndpointConnectionMetadata;
  }[],
): MiotEndpointConnectionMetadata {
  const [candidate] = candidates;

  if (candidate === undefined) {
    throw new Error('Test adapter returned no metadata candidate.');
  }

  return candidate.metadata;
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
