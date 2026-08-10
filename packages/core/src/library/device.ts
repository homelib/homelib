import type {Command} from './command.js';
import type {Endpoint} from './endpoint.js';

export abstract class Device {
  constructor(private readonly entry: DeviceEntry) {}

  get name(): string {
    return this.entry.name;
  }

  get endpoints(): IterableIterator<Endpoint<Command>> {
    return this.entry.endpoints;
  }

  protected getOrCreateEndpoint<TEndpoint extends Endpoint<Command>>(
    Constructor: EndpointConstructor<TEndpoint>,
    name = '',
  ): TEndpoint {
    return this.entry.getOrCreateEndpoint(Constructor, name);
  }
}

export class DeviceEntry {
  private readonly endpointMap = new Map<string, Endpoint<Command>>();

  private readonly instanceMap = new Map<DeviceConstructor<Device>, Device>();

  constructor(readonly name: string) {}

  get endpoints(): IterableIterator<Endpoint<Command>> {
    return this.endpointMap.values();
  }

  get instances(): IterableIterator<Device> {
    return this.instanceMap.values();
  }

  getEndpoint(name = ''): Endpoint<Command> | undefined {
    return this.endpointMap.get(name);
  }

  getOrCreateEndpoint<TEndpoint extends Endpoint<Command>>(
    Constructor: EndpointConstructor<TEndpoint>,
    name = '',
  ): TEndpoint {
    let endpoint = this.endpointMap.get(name);

    if (endpoint === undefined) {
      endpoint = new Constructor(name);
      this.endpointMap.set(name, endpoint);
    } else if (!(endpoint instanceof Constructor)) {
      throw new TypeError(`Incompatible endpoint: ${name}.`);
    }

    return endpoint as TEndpoint;
  }

  getOrCreateInstance<TDevice extends Device>(
    Constructor: DeviceConstructor<TDevice>,
  ): TDevice;
  getOrCreateInstance(Constructor: DeviceConstructor<Device>): Device {
    let instance = this.instanceMap.get(Constructor);

    if (instance === undefined) {
      instance = new Constructor(this);
      this.instanceMap.set(Constructor, instance);
    }

    return instance;
  }
}

export type DeviceConstructor<TDevice extends Device> = new (
  entry: DeviceEntry,
) => TDevice;

type EndpointConstructor<TEndpoint extends Endpoint<Command>> = new (
  name?: string,
) => TEndpoint;
