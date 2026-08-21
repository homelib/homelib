import {
  CommandError,
  ExecuteSmartSpeakerVoiceCommand,
  SmartSpeakerEndpoint,
  SpeakSmartSpeakerTextCommand,
} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../../device.js';
import {MiotSmartSpeakerEndpointConnection} from '../../devices/smart-speaker.js';
import {MiotEndpointConnectionTransport} from '../../endpoint-connection/index.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotInvokeActionRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
  type MiotSpecService,
} from '../../miot/index.js';
import {MiotProvider} from '../../provider.js';

const VERIFIED_SPEAKERS = [
  {
    model: 'xiaomi.wifispeaker.lx04',
    deviceType: 'urn:miot-spec-v2:device:speaker:0000A015:xiaomi-lx04:2',
    serviceType:
      'urn:miot-spec-v2:service:intelligent-speaker:0000789B:xiaomi-lx04:1',
    serviceIid: 5,
    playActionIid: 1,
    executeActionIid: 4,
    silentFormat: 'uint8',
  },
  {
    model: 'xiaomi.wifispeaker.oh2p',
    deviceType: 'urn:miot-spec-v2:device:speaker:0000A015:xiaomi-oh2p:1',
    serviceType:
      'urn:miot-spec-v2:service:intelligent-speaker:0000789B:xiaomi-oh2p:1',
    serviceIid: 7,
    playActionIid: 3,
    executeActionIid: 4,
    silentFormat: 'bool',
  },
] as const;

test.each(VERIFIED_SPEAKERS)(
  'matches the verified $model smart-speaker actions',
  fixture => {
    const resources = resolveMiotEndpointConnectionResources(
      MiotSmartSpeakerEndpointConnection,
      createSpec(fixture),
    );

    expect(MiotSmartSpeakerEndpointConnection.Endpoint).toBe(
      SmartSpeakerEndpoint,
    );
    expect(resources?.map(({service}) => service.iid)).toEqual([
      fixture.serviceIid,
    ]);
    expect(resources?.[0]?.properties['sleep-mode']).toMatchObject({iid: 3});
  },
);

test('rejects an unverified smart-speaker model', () => {
  const spec = createSpec(VERIFIED_SPEAKERS[0]);
  spec.type = 'urn:miot-spec-v2:device:speaker:0000A015:test-speaker:1';

  expect(
    resolveMiotEndpointConnectionResources(
      MiotSmartSpeakerEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test.each(VERIFIED_SPEAKERS)(
  'encodes $model speech and silent voice directives',
  async fixture => {
    const transport = new TestTransport();
    const connection = createConnection(fixture, transport);

    await connection
      .prepareCommand(new SpeakSmartSpeakerTextCommand('欢迎回家'))
      .execute();
    await connection
      .prepareCommand(new ExecuteSmartSpeakerVoiceCommand('关闭客厅灯', true))
      .execute();
    await connection
      .prepareCommand(new ExecuteSmartSpeakerVoiceCommand('播放音乐', false))
      .execute();

    expect(transport.requests).toEqual([
      new MiotInvokeActionRequest(
        {
          did: connection.metadata.device.did,
          siid: fixture.serviceIid,
          aiid: fixture.playActionIid,
        },
        [{piid: 1, value: '欢迎回家'}],
      ),
      new MiotInvokeActionRequest(
        {
          did: connection.metadata.device.did,
          siid: fixture.serviceIid,
          aiid: fixture.executeActionIid,
        },
        [
          {piid: 1, value: '关闭客厅灯'},
          {piid: 2, value: fixture.silentFormat === 'bool' ? true : 0},
        ],
      ),
      new MiotInvokeActionRequest(
        {
          did: connection.metadata.device.did,
          siid: fixture.serviceIid,
          aiid: fixture.executeActionIid,
        },
        [
          {piid: 1, value: '播放音乐'},
          {piid: 2, value: fixture.silentFormat === 'bool' ? false : 1},
        ],
      ),
    ]);
  },
);

test.each([
  'missing play action',
  'duplicate execute action',
  'wrong execute inputs',
] as const)('rejects an invalid smart-speaker action: %s', scenario => {
  const spec = createSpec(VERIFIED_SPEAKERS[0]);
  const service = spec.services[0];

  if (service === undefined) {
    throw new Error('Missing test intelligent-speaker service.');
  }

  const [playAction, executeAction] = service.actions ?? [];

  if (playAction === undefined || executeAction === undefined) {
    throw new Error('Missing test smart-speaker actions.');
  }

  if (scenario === 'missing play action') {
    service.actions = [executeAction];
  } else if (scenario === 'duplicate execute action') {
    service.actions = [
      playAction,
      executeAction,
      {...executeAction, iid: executeAction.iid + 1},
    ];
  } else {
    service.actions = [playAction, {...executeAction, in: [1]}];
  }

  expect(
    resolveMiotEndpointConnectionResources(
      MiotSmartSpeakerEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test.each(VERIFIED_SPEAKERS)(
  'rejects incompatible $model action input formats at command preparation',
  fixture => {
    const textSpec = createSpec(fixture);
    const textProperty = textSpec.services[0]?.properties?.find(
      ({iid}) => iid === 1,
    );

    if (textProperty === undefined) {
      throw new Error('Missing test smart-speaker text input property.');
    }

    textProperty.format = 'uint8';
    const textConnection = createConnection(
      fixture,
      new TestTransport(),
      textSpec,
    );

    expect(() =>
      textConnection.prepareCommand(new SpeakSmartSpeakerTextCommand('测试')),
    ).toThrow(CommandError);

    const silentSpec = createSpec(fixture);
    const silentProperty = silentSpec.services[0]?.properties?.find(
      ({iid}) => iid === 2,
    );

    if (silentProperty === undefined) {
      throw new Error('Missing test smart-speaker silent input property.');
    }

    silentProperty.format = fixture.silentFormat === 'bool' ? 'uint8' : 'bool';
    const silentConnection = createConnection(
      fixture,
      new TestTransport(),
      silentSpec,
    );

    expect(() =>
      silentConnection.prepareCommand(
        new ExecuteSmartSpeakerVoiceCommand('测试', true),
      ),
    ).toThrow(CommandError);
  },
);

function createConnection(
  fixture: (typeof VERIFIED_SPEAKERS)[number],
  transport: TestTransport,
  spec = createSpec(fixture),
): MiotSmartSpeakerEndpointConnection {
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotSmartSpeakerEndpointConnection,
    createMiotEndpointConnectionMetadata(
      {did: `speaker-${fixture.model}`, model: fixture.model},
      spec,
    ),
    spec,
  );

  return new MiotSmartSpeakerEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );
}

function createSpec(
  fixture: (typeof VERIFIED_SPEAKERS)[number],
): MiotSpecInstance {
  const silentProperty: MiotSpecProperty = {
    iid: 2,
    type: `urn:miot-spec-v2:property:silent-execution:000000FB:${fixture.deviceType.includes('lx04') ? 'xiaomi-lx04' : 'xiaomi-oh2p'}:1`,
    description: 'Silent Execution',
    format: fixture.silentFormat,
    access: [],
  };

  if (fixture.silentFormat === 'uint8') {
    silentProperty['value-list'] = [
      {value: 0, description: 'On'},
      {value: 1, description: 'Off'},
    ];
  }

  const service: MiotSpecService = {
    iid: fixture.serviceIid,
    type: fixture.serviceType,
    description: 'Intelligent Speaker',
    properties: [
      {
        iid: 1,
        type: `urn:miot-spec-v2:property:text-content:000000FA:${fixture.deviceType.includes('lx04') ? 'xiaomi-lx04' : 'xiaomi-oh2p'}:1`,
        description: 'Text Content',
        format: 'string',
        access: [],
      },
      silentProperty,
      {
        iid: 3,
        type: `urn:miot-spec-v2:property:sleep-mode:00000028:${fixture.deviceType.includes('lx04') ? 'xiaomi-lx04' : 'xiaomi-oh2p'}:${fixture.deviceType.includes('lx04') ? '2' : '1'}`,
        description: 'Sleep Mode',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    ],
    actions: [
      {
        iid: fixture.playActionIid,
        type: `urn:miot-spec-v2:action:play-text:00002841:${fixture.deviceType.includes('lx04') ? 'xiaomi-lx04' : 'xiaomi-oh2p'}:1`,
        description: 'Play Text',
        in: [1],
        out: [],
      },
      {
        iid: fixture.executeActionIid,
        type: `urn:miot-spec-v2:action:execute-text-directive:00002842:${fixture.deviceType.includes('lx04') ? 'xiaomi-lx04' : 'xiaomi-oh2p'}:1`,
        description: 'Execute Text Directive',
        in: [1, 2],
        out: [],
      },
    ],
  };

  return {
    type: fixture.deviceType,
    description: 'Speaker',
    services: [service],
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
