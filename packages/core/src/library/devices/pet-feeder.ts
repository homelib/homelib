import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export type PetFoodLevel = 'normal' | 'low';

export class PetFeeder extends Device {
  protected readonly endpoint: PetFeederEndpoint;

  /** Whether the food remaining in the hopper is normal or low. */
  @computed
  get foodLevel(): PetFoodLevel | undefined {
    return this.endpoint.foodLevel;
  }

  /** Current weight of the food remaining in the bowl, in grams. */
  @computed
  get bowlFoodWeight(): number | undefined {
    return this.endpoint.bowlFoodWeight;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(PetFeederEndpoint);
  }

  /** Dispenses the requested number of portions of pet food. */
  dispense(portions: number): this {
    this.endpoint.dispense(portions);
    return this;
  }
}

export class PetFeederEndpoint<
  TConnection extends PetFeederEndpointConnection = PetFeederEndpointConnection,
> extends Endpoint<PetFeederEndpointCommand, TConnection> {
  /** Whether the food remaining in the hopper is normal or low. */
  @computed
  get foodLevel(): PetFoodLevel | undefined {
    return this.connection?.foodLevel;
  }

  /** Current weight of the food remaining in the bowl, in grams. */
  @computed
  get bowlFoodWeight(): number | undefined {
    return this.connection?.bowlFoodWeight;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      foodLevel: this.foodLevel,
      bowlFoodWeightGrams: this.bowlFoodWeight,
    };
  }

  /** Dispenses the requested number of portions of pet food. */
  dispense(portions: number): this {
    return this.enqueueCommand(new DispensePetFoodCommand(portions));
  }
}

export type PetFeederEndpointConnection =
  EndpointConnection<PetFeederEndpointCommand> & {
    /** Whether the food remaining in the hopper is normal or low. */
    readonly foodLevel: PetFoodLevel | undefined;
    /** Current weight of the food remaining in the bowl, in grams. */
    readonly bowlFoodWeight: number | undefined;
  };

/** A one-shot command; equal values must still dispense food again. */
export class DispensePetFoodCommand extends Command {
  constructor(readonly portions: number) {
    super();

    if (!Number.isInteger(portions) || portions <= 0) {
      throw new RangeError(
        'Pet food portion count must be a positive whole number.',
      );
    }
  }

  override toLogString(): string {
    return `dispense portions=${this.portions}`;
  }
}

export type PetFeederEndpointCommand = DispensePetFoodCommand;
