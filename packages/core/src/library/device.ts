import type {Command} from './command.js';
import type {Endpoint} from './endpoint.js';

export abstract class Device {
  private readonly endpointSet = new Set<Endpoint<Command>>();

  /** @internal */
  get _endpoints(): ReadonlySet<Endpoint<Command>> {
    return this.endpointSet;
  }

  protected registerEndpoint<TEndpoint extends Endpoint<Command>>(
    endpoint: TEndpoint,
  ): TEndpoint {
    this.endpointSet.add(endpoint);
    return endpoint;
  }
}
