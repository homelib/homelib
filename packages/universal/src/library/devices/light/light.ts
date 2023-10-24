import {$constructor, Device, DeviceEndpoint} from '@homelib/core';
import type {IObservableValue} from '@homelib/core/mobx';
import type {Endpoint} from '@project-chip/matter-node.js/device';
import {OnOffCluster} from '@project-chip/matter.js/cluster';

export class Light extends Device<LightEndpoint> {
  readonly type = '@homelib/universal/light';

  override async connect(endpoint: Endpoint): Promise<LightEndpoint> {
    return new LightEndpoint(endpoint);
  }
}

export class LightEndpoint extends DeviceEndpoint {
  private _on: IObservableValue<boolean | undefined>;

  get on(): boolean | undefined {
    return this._on.get();
  }

  constructor(endpoint: Endpoint) {
    super(endpoint);

    this._on = this.getClusterAttributeObservable(OnOffCluster, 'onOff');
  }

  async toggle(on = this._on.get() ?? true): Promise<void> {
    const {endpoint} = this;

    const clusterClient = endpoint.getClusterClient(OnOffCluster)!;

    await clusterClient.attributes.onOff.set(on);
  }

  override dispose(): void {}
}

export const $light = $constructor(Light);
