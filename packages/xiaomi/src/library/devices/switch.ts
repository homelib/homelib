import {
  type CommandExecution,
  SetSwitchOnCommand,
  SwitchEndpoint,
  type SwitchEndpointCommand,
  type SwitchEndpointConnection,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotCommandEffect} from '../command/index.js';
import {MiotEndpointConnection} from '../endpoint-connection/index.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  encodeMiotPropertyValue,
} from '../miot/index.js';

/** Xiaomi Wall Switch (xiaomi.switch.w1). */
export class MiotSwitchEndpointConnection
  extends MiotEndpointConnection<
    SwitchEndpointCommand,
    typeof MiotSwitchEndpointConnection.properties
  >
  implements SwitchEndpointConnection
{
  static readonly Endpoint = SwitchEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:switch:0000780C:xiaomi-w1:1:0000C808': {
      'urn:miot-spec-v2:property:on:00000006:xiaomi-w1:1:0000C808': {
        name: 'on',
        iid: {
          'urn:miot-spec-v2:device:switch:0000A003:xiaomi-w1:2:0000C808': 1,
        },
      },
    },
  } as const satisfies MiotPropertySchema;

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  override prepareCommand(command: SwitchEndpointCommand): CommandExecution {
    if (!(command instanceof SetSwitchOnCommand)) {
      throw new TypeError('Unsupported MIoT switch endpoint command.');
    }

    const effect = new MiotSwitchCommandEffect(this, {
      on: encodeMiotPropertyValue(this.properties.on, command.value),
    });
    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotSwitchEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotSwitchEndpointConnection.properties
>;

class MiotSwitchCommandEffect extends MiotCommandEffect<
  keyof MiotSwitchEndpointProperties
> {}
