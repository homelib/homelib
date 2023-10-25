import type {Endpoint} from '@project-chip/matter-node.js/device';
import type {Attribute} from '@project-chip/matter.js/cluster';
import type {IObservableValue} from 'mobx';
import {observable} from 'mobx';

import type {UnknownAttributeClients, UnknownCluster} from '../@matter.js';

export abstract class DeviceEndpoint {
  constructor(readonly endpoint: Endpoint) {}

  abstract dispose(): Promise<void> | void;

  protected getClusterAttributeObservable<
    TCluster extends UnknownCluster,
    TAttributeName extends keyof TCluster['attributes'],
  >(
    cluster: TCluster,
    name: TAttributeName,
  ): IObservableValue<
    TCluster['attributes'][TAttributeName] extends Attribute<infer T, any>
      ? T | undefined
      : never
  >;
  protected getClusterAttributeObservable(
    cluster: UnknownCluster,
    name: string,
  ): IObservableValue<unknown> {
    const clusterClient = this.endpoint.getClusterClient(cluster)!;

    const observableValue = observable.box();

    (clusterClient.attributes as UnknownAttributeClients)[name].addListener(
      value => observableValue.set(value),
    );

    return observableValue;
  }
}
