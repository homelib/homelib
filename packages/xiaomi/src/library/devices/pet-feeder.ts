import {
  CommandError,
  type CommandExecution,
  DispensePetFoodCommand,
  PetFeederEndpoint,
  type PetFeederEndpointCommand,
  type PetFeederEndpointConnection,
  type PetFoodLevel,
} from '@homelib/core';
import {computed} from 'mobx';

import {createMiotNamedValueCodecDefinition} from '../@endpoint-connection/index.js';
import {MiotEndpointConnection} from '../endpoint-connection/index.js';
import {
  type MiotActionSchema,
  MiotInvokeActionRequest,
  type MiotPropertySchema,
  type MiotSpecProperty,
  isValidMiotSpecValueRange,
  resolveMiotActionSchema,
} from '../miot/index.js';

const PET_FOOD_LEVEL_CODEC_DEFINITION =
  createMiotNamedValueCodecDefinition<PetFoodLevel>({
    '*': {normal: 0, low: 1},
  });

export class MiotPetFeederEndpointConnection
  extends MiotEndpointConnection<
    PetFeederEndpointCommand,
    typeof MiotPetFeederEndpointConnection.properties
  >
  implements PetFeederEndpointConnection
{
  static readonly Endpoint = PetFeederEndpoint;
  static readonly actions = {
    'urn:miot-spec-v2:service:pet-feeder:00007847': {
      'urn:miot-spec-v2:action:pet-food-out:0000282B': {
        in: ['urn:miot-spec-v2:property:feeding-measure:00000080'],
        out: [],
      },
    },
  } as const satisfies MiotActionSchema;

  static readonly properties = {
    'urn:miot-spec-v2:service:pet-feeder:00007847': {
      'urn:miot-spec-v2:property:pet-food-left-level:0000010E': {
        name: 'pet-food-left-level',
      },
      'urn:miot-spec-v2:property:eaten-food-measure:000002FA': {
        name: 'eaten-food-measure',
        iid: {
          'urn:miot-spec-v2:device:pet-feeder:0000A06C:xiaomi-pi2001,urn:miot-spec-v2:device:pet-feeder:0000A06C:xiaomi-iv2001': 22,
        },
      },
    },
  } as const satisfies MiotPropertySchema;

  private readonly foodLevelBinding = this.bindPropertyValue(
    'pet-food-left-level',
    PET_FOOD_LEVEL_CODEC_DEFINITION,
  );

  @computed
  get foodLevel(): PetFoodLevel | undefined {
    return this.foodLevelBinding?.read();
  }

  @computed
  get bowlFoodWeight(): number | undefined {
    return this.getNumberPropertyState('eaten-food-measure');
  }

  override prepareCommand(command: PetFeederEndpointCommand): CommandExecution {
    if (command instanceof DispensePetFoodCommand) {
      const request = this.createDispenseRequest(command.portions);

      return {
        execute: () => this.executeRequest(request),
        toLogString: () => command.toLogString(),
      };
    }

    throw new TypeError('Unsupported MIoT pet feeder endpoint command.');
  }

  private createDispenseRequest(portions: number): MiotInvokeActionRequest {
    const [resolvedAction] =
      resolveMiotActionSchema(
        this.metadata.resources,
        MiotPetFeederEndpointConnection.actions,
      ) ?? [];
    const [inputProperty] = resolvedAction?.in ?? [];

    if (
      resolvedAction === undefined ||
      resolvedAction.in.length !== 1 ||
      inputProperty === undefined ||
      !supportsMiotPropertyValue(inputProperty, portions)
    ) {
      throw new CommandError(
        `MIoT pet feeder does not support dispensing ${portions} portions.`,
      );
    }

    return new MiotInvokeActionRequest(
      {
        did: this.metadata.device.did,
        siid: resolvedAction.service.iid,
        aiid: resolvedAction.action.iid,
      },
      [{piid: inputProperty.iid, value: portions}],
    );
  }
}

function supportsMiotPropertyValue(
  property: MiotSpecProperty,
  value: number,
): boolean {
  const range = property['value-range'];

  if (!isValidMiotSpecValueRange(range, property.format)) {
    return false;
  }

  const [minimum, maximum, step] = range;
  return (
    value >= minimum &&
    value <= maximum &&
    Math.abs((value - minimum) / step - Math.round((value - minimum) / step)) <
      Number.EPSILON * 16
  );
}
