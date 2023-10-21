import type {Endpoint} from '@project-chip/matter-node.js/device';
import type {Attribute} from '@project-chip/matter.js/cluster';
import type {IComputedValue} from 'mobx';
import {observable, computed} from 'mobx';

import type {UnknownAttributeClients, UnknownCluster} from '../@matter.js';

export abstract class DeviceEndpoint {
  constructor(readonly endpoint: Endpoint) {}

  abstract dispose(): Promise<void> | void;

  getClusterAttributeObservable<
    TCluster extends UnknownCluster,
    TAttributeName extends keyof TCluster['attributes'],
  >(
    cluster: TCluster,
    name: TAttributeName,
  ): IComputedValue<
    TCluster['attributes'][TAttributeName] extends Attribute<infer T, any>
      ? T | undefined
      : never
  >;
  getClusterAttributeObservable(
    cluster: UnknownCluster,
    name: string,
  ): IComputedValue<unknown> {
    const observableValue = observable.box();

    (cluster.attributes as UnknownAttributeClients)[name].addListener(value =>
      observableValue.set(value),
    );

    return computed(() => observableValue.get());
  }
}
