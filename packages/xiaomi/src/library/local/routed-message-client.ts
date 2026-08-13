import type {
  CloudDeviceMessageClient,
  CloudMqttConnectionStateListener,
  CloudMqttDeviceMessageHandler,
} from '../cloud/index.js';
import type {MiotProperty} from '../miot/index.js';

export class RoutedDeviceMessageClient implements CloudDeviceMessageClient {
  private readonly subscriptionMap = new Map<string, RoutedSubscription>();

  private readonly connectionStateListenerSet =
    new Set<CloudMqttConnectionStateListener>();

  private cloudConnected = false;

  private connectedValue = false;

  private disconnecting = false;

  constructor(
    private readonly cloud: CloudDeviceMessageClient,
    private readonly local: RoutedLocalMessageSource,
  ) {
    this.cloud.addConnectionStateListener(connected => {
      const wasConnected = this.connectedValue;
      const cloudChanged = this.cloudConnected !== connected;
      this.cloudConnected = connected;
      this.updateConnected();
      void this.refreshSubscriptions().catch(console.error);

      if (cloudChanged && wasConnected && this.connectedValue) {
        this.notifyConnectionState(false);
        this.notifyConnectionState(true);
      }
    });
    this.local.addRoutesChangedListener(() => {
      this.updateConnected();
      void this.refreshSubscriptions().catch(console.error);
    });
  }

  updateAccessToken(accessToken: string): void {
    this.cloud.updateAccessToken(accessToken);
  }

  async connect(): Promise<void> {
    if (this.disconnecting) {
      throw new Error('MIoT message client is disconnecting.');
    }

    const localOperation = this.local.connect().then(() => {
      if (!this.local.connected) {
        throw new Error('No local MIoT message route is connected.');
      }
    });

    await Promise.any([this.cloud.connect(), localOperation]);

    this.updateConnected();
    await this.refreshSubscriptions();
  }

  async disconnect(): Promise<void> {
    if (this.disconnecting) {
      return;
    }

    this.disconnecting = true;
    const errors: unknown[] = [];
    const subscriptions = [...this.subscriptionMap.values()];
    this.subscriptionMap.clear();

    for (const subscription of subscriptions) {
      try {
        await subscription.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    const results = await Promise.allSettled([
      this.local.disconnect(),
      this.cloud.disconnect(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }

    this.cloudConnected = false;
    this.updateConnected();
    this.disconnecting = false;

    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to disconnect MIoT messages.');
    }
  }

  async subscribeDevice(
    did: string,
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<void> {
    if (this.disconnecting) {
      throw new Error('MIoT message client is disconnecting.');
    }

    const existing = this.subscriptionMap.get(did);

    if (existing !== undefined) {
      if (existing.handler !== handler) {
        throw new Error(`MIoT device ${did} is already subscribed.`);
      }

      return;
    }

    const subscription = new RoutedSubscription(did, handler, this);
    this.subscriptionMap.set(did, subscription);

    try {
      await subscription.refresh();
    } catch (error) {
      this.subscriptionMap.delete(did);
      throw error;
    }
  }

  async unsubscribeDevice(did: string): Promise<void> {
    const subscription = this.subscriptionMap.get(did);

    if (subscription === undefined) {
      return;
    }

    this.subscriptionMap.delete(did);
    await subscription.dispose();
  }

  addConnectionStateListener(
    listener: CloudMqttConnectionStateListener,
  ): () => void {
    this.connectionStateListenerSet.add(listener);

    return () => {
      this.connectionStateListenerSet.delete(listener);
    };
  }

  resolveSource(did: string): RoutedMessageSource {
    const localSource = this.local.getMessageSource(did);

    if (localSource !== undefined) {
      return {
        identity: localSource,
        subscribe: async handler => {
          const subscriptions: Array<{dispose(): Promise<void>}> = [];

          try {
            subscriptions.push(
              await localSource.subscribeProperties(did, update => {
                handler({...update, type: 'property'});
              }),
            );
            subscriptions.push(
              await localSource.subscribeEvents(did, update => {
                handler({...update, type: 'event'});
              }),
            );
          } catch (error) {
            await disposeSubscriptions(subscriptions).catch(console.error);
            throw error;
          }

          return () => disposeSubscriptions(subscriptions);
        },
      };
    }

    return {
      identity: this.cloud,
      subscribe: async handler => {
        await this.cloud.subscribeDevice(did, handler);
        return () => this.cloud.unsubscribeDevice(did);
      },
    };
  }

  private async refreshSubscriptions(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.subscriptionMap.values()].map(subscription =>
        subscription.refresh(),
      ),
    );
    let changed = false;

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(result.reason);
      } else if (result.value) {
        changed = true;
      }
    }

    if (changed && this.connectedValue) {
      this.notifyConnectionState(false);
      this.notifyConnectionState(true);
    }
  }

  private updateConnected(): void {
    const connected = this.cloudConnected || this.local.connected;

    if (this.connectedValue === connected) {
      return;
    }

    this.connectedValue = connected;
    this.notifyConnectionState(connected);
  }

  private notifyConnectionState(connected: boolean): void {
    for (const listener of this.connectionStateListenerSet) {
      try {
        listener(connected);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

class RoutedSubscription {
  private sourceSubscription: ActiveSourceSubscription | undefined;

  private operation: Promise<void> = Promise.resolve();

  private disposed = false;

  constructor(
    readonly did: string,
    readonly handler: CloudMqttDeviceMessageHandler,
    private readonly client: RoutedDeviceMessageClient,
  ) {}

  refresh(): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }

    let changed = false;
    const operation = this.operation.then(async () => {
      if (this.disposed) {
        return;
      }

      const source = this.client.resolveSource(this.did);
      const previous = this.sourceSubscription;

      if (previous?.identity === source.identity) {
        return;
      }

      const token = {};
      let dispose: (() => Promise<void>) | undefined;

      try {
        dispose = await source.subscribe(message => {
          if (this.sourceSubscription?.token === token) {
            this.handler(message);
          }
        });
        this.sourceSubscription = {
          identity: source.identity,
          token,
          dispose,
        };
        changed = true;
      } catch (error) {
        if (dispose !== undefined) {
          await dispose().catch(console.error);
        }

        if (this.sourceSubscription?.token === token) {
          this.sourceSubscription = previous;
        }

        throw error;
      }

      if (previous !== undefined) {
        await previous.dispose().catch(console.error);
      }
    });

    this.operation = operation.catch(() => undefined);
    return operation.then(() => changed);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      await this.operation;
      return;
    }

    this.disposed = true;
    const operation = this.operation.then(async () => {
      const subscription = this.sourceSubscription;
      this.sourceSubscription = undefined;
      await subscription?.dispose();
    });
    this.operation = operation.catch(() => undefined);
    await operation;
  }
}

export type RoutedLocalMessageSource = {
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  addRoutesChangedListener(listener: () => void): () => void;
  getMessageSource(did: string): LocalDeviceMessageSource | undefined;
};

export type LocalDeviceMessageSource = {
  subscribeProperties(
    did: string,
    listener: (update: MiotProperty & {readonly value: unknown}) => void,
  ): Promise<{dispose(): Promise<void>}>;
  subscribeEvents(
    did: string,
    listener: (update: {
      readonly did: string;
      readonly siid: number;
      readonly eiid: number;
      readonly arguments: readonly unknown[];
    }) => void,
  ): Promise<{dispose(): Promise<void>}>;
};

type RoutedMessageSource = {
  readonly identity: object;
  subscribe(
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<() => Promise<void>>;
};

type ActiveSourceSubscription = {
  readonly identity: object;
  readonly token: object;
  readonly dispose: () => Promise<void>;
};

async function disposeSubscriptions(
  subscriptions: readonly {dispose(): Promise<void>}[],
): Promise<void> {
  const results = await Promise.allSettled(
    subscriptions.map(subscription => subscription.dispose()),
  );
  const errors = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    .map(result => result.reason as unknown);

  if (errors.length === 1) {
    throw errors[0];
  } else if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Failed to unsubscribe local MIoT messages.',
    );
  }
}
