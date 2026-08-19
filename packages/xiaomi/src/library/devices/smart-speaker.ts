import {
  CommandError,
  type CommandExecution,
  ExecuteSmartSpeakerVoiceCommand,
  SmartSpeakerEndpoint,
  type SmartSpeakerEndpointCommand,
  type SmartSpeakerEndpointConnection,
  SpeakSmartSpeakerTextCommand,
} from '@homelib/core';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotActionSchema,
  type MiotActionSchemaMatch,
  MiotInvokeActionRequest,
  type MiotPropertySchema,
  matchesMiotUrnPattern,
  resolveMiotActionSchema,
} from '../miot/index.js';

import {encodeMiotPropertyValue} from './command-effect.js';

export class MiotSmartSpeakerEndpointConnection
  extends MiotEndpointConnection<
    SmartSpeakerEndpointCommand,
    typeof MiotSmartSpeakerEndpointConnection.properties
  >
  implements SmartSpeakerEndpointConnection
{
  static readonly Endpoint = SmartSpeakerEndpoint;

  static readonly actions = {
    'urn:miot-spec-v2:service:intelligent-speaker:0000789B': {
      'urn:miot-spec-v2:action:play-text:00002841': {
        in: ['urn:miot-spec-v2:property:text-content:000000FA'],
        out: [],
      },
      'urn:miot-spec-v2:action:execute-text-directive:00002842': {
        in: [
          'urn:miot-spec-v2:property:text-content:000000FA',
          'urn:miot-spec-v2:property:silent-execution:000000FB',
        ],
        out: [],
      },
    },
  } as const satisfies MiotActionSchema;

  static readonly properties = {
    'urn:miot-spec-v2:service:intelligent-speaker:0000789B': {
      'urn:miot-spec-v2:property:sleep-mode:00000028': {
        name: 'sleep-mode',
        iid: {
          'urn:miot-spec-v2:device:speaker:0000A015:xiaomi-lx04:2,urn:miot-spec-v2:device:speaker:0000A015:xiaomi-oh2p:1': 3,
        },
      },
    },
  } as const satisfies MiotPropertySchema;

  override prepareCommand(
    command: SmartSpeakerEndpointCommand,
  ): CommandExecution {
    let request: MiotInvokeActionRequest;

    if (command instanceof SpeakSmartSpeakerTextCommand) {
      request = this.createSpeakRequest(command.text);
    } else if (command instanceof ExecuteSmartSpeakerVoiceCommand) {
      request = this.createVoiceCommandRequest(command.text, command.silent);
    } else {
      throw new TypeError('Unsupported MIoT smart-speaker endpoint command.');
    }

    return {
      execute: () => this.executeRequest(request),
      toLogString: () => command.toLogString(),
    };
  }

  private createSpeakRequest(text: string): MiotInvokeActionRequest {
    const action = this.getPlayTextAction();
    const [textProperty] = action?.in ?? [];

    if (action === undefined || textProperty === undefined) {
      throw new CommandError('MIoT smart speaker does not support speaking.');
    }

    let value: unknown;

    try {
      value = encodeMiotPropertyValue(textProperty, text);
    } catch {
      throw new CommandError('MIoT smart speaker does not support speaking.');
    }

    return new MiotInvokeActionRequest(
      {
        did: this.metadata.device.did,
        siid: action.service.iid,
        aiid: action.action.iid,
      },
      [{piid: textProperty.iid, value}],
    );
  }

  private createVoiceCommandRequest(
    text: string,
    silent: boolean,
  ): MiotInvokeActionRequest {
    const action = this.getExecuteTextDirectiveAction();
    const [textProperty, silentProperty] = action?.in ?? [];

    if (
      action === undefined ||
      textProperty === undefined ||
      silentProperty === undefined
    ) {
      throw new CommandError(
        'MIoT smart speaker does not support voice commands.',
      );
    }

    let textValue: unknown;
    let silentValue: unknown;

    try {
      textValue = encodeMiotPropertyValue(textProperty, text);
      silentValue = this.encodeSilentExecution(silentProperty, silent);
    } catch {
      throw new CommandError(
        'MIoT smart speaker does not support voice commands.',
      );
    }

    return new MiotInvokeActionRequest(
      {
        did: this.metadata.device.did,
        siid: action.service.iid,
        aiid: action.action.iid,
      },
      [
        {piid: textProperty.iid, value: textValue},
        {piid: silentProperty.iid, value: silentValue},
      ],
    );
  }

  private encodeSilentExecution(
    property: MiotActionSchemaMatch['in'][number],
    silent: boolean,
  ): unknown {
    if (
      matchesMiotUrnPattern(
        this.metadata.device.urn,
        'urn:miot-spec-v2:device:speaker:0000A015:xiaomi-lx04:2',
      )
    ) {
      // lx04 reverses the usual boolean encoding: enabled silence is 0.
      return encodeMiotPropertyValue(property, silent ? 0 : 1);
    }

    if (
      matchesMiotUrnPattern(
        this.metadata.device.urn,
        'urn:miot-spec-v2:device:speaker:0000A015:xiaomi-oh2p:1',
      )
    ) {
      return encodeMiotPropertyValue(property, silent);
    }

    throw new TypeError('Unsupported MIoT silent-execution encoding.');
  }

  private getPlayTextAction(): MiotActionSchemaMatch | undefined {
    return this.getActions()?.find(({action}) =>
      matchesMiotUrnPattern(
        action.type,
        'urn:miot-spec-v2:action:play-text:00002841',
      ),
    );
  }

  private getExecuteTextDirectiveAction(): MiotActionSchemaMatch | undefined {
    return this.getActions()?.find(({action}) =>
      matchesMiotUrnPattern(
        action.type,
        'urn:miot-spec-v2:action:execute-text-directive:00002842',
      ),
    );
  }

  private getActions(): readonly MiotActionSchemaMatch[] | undefined {
    return resolveMiotActionSchema(
      this.metadata.resources,
      MiotSmartSpeakerEndpointConnection.actions,
    );
  }
}
