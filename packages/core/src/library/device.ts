import {computed} from 'mobx';

import {assertDeclaring} from './@lifecycle.js';
import type {EndpointReference} from './endpoint.js';

export abstract class Device {
  constructor(private readonly entry: DeviceEntry) {}

  get name(): string {
    return this.entry.name;
  }

  @computed
  get ready(): boolean {
    return this.entry.endpoints.every(endpoint => endpoint.ready);
  }

  protected getOrCreateEndpoint<TEndpoint extends EndpointReference>(
    Constructor: EndpointConstructor<TEndpoint>,
    name = '',
  ): TEndpoint {
    return this.entry.getOrCreateEndpoint(Constructor, name);
  }
}

export class DeviceEntry {
  private readonly endpointMap = new Map<string, EndpointReference>();

  private readonly instanceMap = new Map<DeviceConstructor<Device>, Device>();

  constructor(readonly name: string) {}

  get endpoints(): MapIterator<EndpointReference> {
    return this.endpointMap.values();
  }

  get instances(): IterableIterator<Device> {
    return this.instanceMap.values();
  }

  get constructors(): IterableIterator<DeviceConstructor<Device>> {
    return this.instanceMap.keys();
  }

  getEndpoint(name = ''): EndpointReference | undefined {
    return this.endpointMap.get(name);
  }

  getOrCreateEndpoint<TEndpoint extends EndpointReference>(
    Constructor: EndpointConstructor<TEndpoint>,
    name = '',
  ): TEndpoint {
    let endpoint = this.endpointMap.get(name);

    if (endpoint === undefined) {
      assertDeclaring();
      endpoint = new Constructor(name);
      this.endpointMap.set(name, endpoint);
    } else if (!(endpoint instanceof Constructor)) {
      throw new TypeError(`Incompatible endpoint: ${name}.`);
    }

    return endpoint as TEndpoint;
  }

  createInstance<TDevice extends Device>(
    Constructor: DeviceConstructor<TDevice>,
  ): TDevice;
  createInstance(Constructor: DeviceConstructor<Device>): Device {
    assertDeclaring();

    const existingInstance = this.instanceMap.get(Constructor);

    if (existingInstance !== undefined) {
      throw new TypeError(`Duplicate device instance: ${this.name}.`);
    }

    const instance = new Constructor(this);
    this.instanceMap.set(Constructor, instance);

    return instance;
  }
}

export type DeviceConstructor<TDevice extends Device> = new (
  entry: DeviceEntry,
) => TDevice;

type EndpointConstructor<TEndpoint extends EndpointReference> = new (
  name?: string,
) => TEndpoint;
