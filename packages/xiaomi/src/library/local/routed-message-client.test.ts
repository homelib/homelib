import type {
  CloudDeviceMessageClient,
  CloudMqttConnectionStateListener,
  CloudMqttDeviceMessage,
  CloudMqttDeviceMessageHandler,
} from '../cloud/index.js';
import type {MiotProperty} from '../miot/index.js';

import {
  type LocalDeviceMessageSource,
  RoutedDeviceMessageClient,
  type RoutedLocalMessageSource,
} from './routed-message-client.js';

test('switches cloud to local and back without accepting late old-source messages', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);
  const states: boolean[] = [];
  const messages: CloudMqttDeviceMessage[] = [];
  client.addConnectionStateListener(connected => {
    states.push(connected);
  });
  await client.connect();
  await client.subscribeDevice('device-1', message => {
    messages.push(message);
  });

  const oldCloudHandler = cloud.requireHandler('device-1');
  cloud.emitProperty('device-1', 1);
  const cloudUnsubscribe = cloud.deferNextUnsubscribe();
  const localSource = new TestLocalPropertySource();
  local.setRoute('device-1', localSource);
  await waitFor(() => cloud.unsubscribeCalls.length === 1);

  oldCloudHandler(createPropertyMessage('device-1', 2));
  localSource.emitProperty('device-1', 3);
  localSource.emitEvent('device-1', 4);
  localSource.emitIdentifiedEvent('device-1', 5);
  expect(messages).toEqual([
    createPropertyMessage('device-1', 1),
    createPropertyMessage('device-1', 3),
    createEventMessage('device-1', 4),
    createIdentifiedEventMessage('device-1', 5),
  ]);

  cloudUnsubscribe.resolve();
  await flushMicrotasks();
  const oldLocalListener = localSource.requireListener();
  const localDispose = localSource.deferNextDispose();
  local.removeRoute('device-1');
  await waitFor(() => localSource.disposeCalls === 1);

  oldLocalListener(createPropertyUpdate('device-1', 4));
  cloud.emitProperty('device-1', 5);
  expect(messages).toEqual([
    createPropertyMessage('device-1', 1),
    createPropertyMessage('device-1', 3),
    createEventMessage('device-1', 4),
    createIdentifiedEventMessage('device-1', 5),
    createPropertyMessage('device-1', 5),
  ]);

  localDispose.resolve();
  await waitFor(() => states.length === 5);
  expect(states).toEqual([true, false, true, false, true]);
  await client.disconnect();
});

test('preserves object, array, and mixed local event values as positional', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const localSource = new TestLocalPropertySource();
  local.setRoute('device-1', localSource);
  const client = new RoutedDeviceMessageClient(cloud, local);
  const messages: CloudMqttDeviceMessage[] = [];

  await client.connect();
  await client.subscribeDevice('device-1', message => {
    messages.push(message);
  });

  const objectValues = [{vendor: 42}];
  const arrayValues = [[1, 2]];
  const mixedValues = [{piid: 2, value: 1}, 'vendor-raw'];
  localSource.emitEventArguments('device-1', objectValues);
  localSource.emitEventArguments('device-1', arrayValues);
  localSource.emitEventArguments('device-1', mixedValues);

  expect(messages).toEqual([
    createPositionalEventMessage('device-1', objectValues),
    createPositionalEventMessage('device-1', arrayValues),
    createPositionalEventMessage('device-1', mixedValues),
  ]);

  await client.disconnect();
});

test('buffers local messages in arrival order until the source becomes active', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);
  const messages: CloudMqttDeviceMessage[] = [];
  await client.connect();
  await client.subscribeDevice('device-1', message => {
    messages.push(message);
  });

  const localSource = new TestLocalPropertySource();
  const eventSubscription = localSource.deferNextEventSubscription();
  local.setRoute('device-1', localSource);
  await waitFor(() => localSource.hasEventListener);

  localSource.emitProperty('device-1', 1);
  localSource.emitEvent('device-1', 2);
  localSource.emitProperty('device-1', 3);

  expect(messages).toEqual([]);

  eventSubscription.resolve();
  await waitFor(() => messages.length === 3);

  expect(messages).toEqual([
    createPropertyMessage('device-1', 1),
    createEventMessage('device-1', 2),
    createPropertyMessage('device-1', 3),
  ]);

  await client.disconnect();
});

test('discards and cleans up messages from a source replaced while subscribing', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);
  const messages: CloudMqttDeviceMessage[] = [];
  await client.connect();
  await client.subscribeDevice('device-1', message => {
    messages.push(message);
  });

  const staleSource = new TestLocalPropertySource();
  const staleSubscription = staleSource.deferNextEventSubscription();
  local.setRoute('device-1', staleSource);
  await waitFor(() => staleSource.hasEventListener);

  staleSource.emitProperty('device-1', 1);
  staleSource.emitEvent('device-1', 2);

  const currentSource = new TestLocalPropertySource();
  local.setRoute('device-1', currentSource);
  staleSubscription.resolve();

  await waitFor(
    () => staleSource.disposeCalls === 1 && currentSource.hasEventListener,
  );

  expect(messages).toEqual([]);
  expect(staleSource.hasEventListener).toBe(false);

  currentSource.emitProperty('device-1', 3);
  currentSource.emitEvent('device-1', 4);
  await waitFor(() => messages.length === 2);

  expect(messages).toEqual([
    createPropertyMessage('device-1', 3),
    createEventMessage('device-1', 4),
  ]);

  await client.disconnect();
});

test('discards buffered messages and cleans up after subscription failure', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);
  const messages: CloudMqttDeviceMessage[] = [];
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = error => {
    errors.push(error);
  };

  try {
    await client.connect();
    await client.subscribeDevice('device-1', message => {
      messages.push(message);
    });

    const localSource = new TestLocalPropertySource();
    const eventSubscription = localSource.deferNextEventSubscription();
    const subscriptionError = new Error('Local event subscription failed.');
    local.setRoute('device-1', localSource);
    await waitFor(() => localSource.hasEventListener);

    localSource.emitProperty('device-1', 1);
    localSource.emitEvent('device-1', 2);
    eventSubscription.reject(subscriptionError);

    await waitFor(() => errors.length === 1);

    expect(errors).toEqual([subscriptionError]);
    expect(messages).toEqual([]);
    expect(localSource.disposeCalls).toBe(1);
    expect(localSource.hasEventListener).toBe(false);

    cloud.emitProperty('device-1', 3);
    expect(messages).toEqual([createPropertyMessage('device-1', 3)]);
  } finally {
    console.error = originalError;
    await client.disconnect();
  }
});

test.each([
  ['cloud', undefined, new Error('local unavailable')],
  ['local', new Error('cloud unavailable'), undefined],
] as const)(
  'connects when only the %s message source succeeds',
  async (_source, cloudConnectError, localConnectError) => {
    const cloud = new TestCloudMessageClient(cloudConnectError);
    const local = new TestLocalMessageRouter(localConnectError);
    const client = new RoutedDeviceMessageClient(cloud, local);

    await expect(client.connect()).resolves.toBeUndefined();
    await client.disconnect();
  },
);

test('rejects connection only when both message sources fail', async () => {
  const client = new RoutedDeviceMessageClient(
    new TestCloudMessageClient(new Error('cloud unavailable')),
    new TestLocalMessageRouter(new Error('local unavailable')),
  );

  await expect(client.connect()).rejects.toThrow(AggregateError);
});

test('does not wait for a pending cloud connection when local is ready', async () => {
  const cloud = new TestCloudMessageClient();
  const cloudConnection = cloud.deferNextConnect();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);

  await expect(client.connect()).resolves.toBeUndefined();
  expect(local.connected).toBe(true);

  cloudConnection.reject(new Error('Late cloud failure.'));
  await client.disconnect();
});

test('pulses refresh when cloud reconnects while a local route stays connected', async () => {
  const cloud = new TestCloudMessageClient();
  const local = new TestLocalMessageRouter();
  const client = new RoutedDeviceMessageClient(cloud, local);
  const states: boolean[] = [];
  client.addConnectionStateListener(connected => {
    states.push(connected);
  });
  await client.connect();

  cloud.setConnected(false);
  cloud.setConnected(true);

  expect(states).toEqual([true, false, true, false, true]);
  await client.disconnect();
});

class TestCloudMessageClient implements CloudDeviceMessageClient {
  private readonly handlerMap = new Map<
    string,
    CloudMqttDeviceMessageHandler
  >();

  private readonly connectionStateListenerSet =
    new Set<CloudMqttConnectionStateListener>();

  private nextUnsubscribe: Deferred<void> | undefined;

  private nextConnect: Deferred<void> | undefined;

  private connected = false;

  readonly unsubscribeCalls: string[] = [];

  constructor(private readonly connectError?: Error) {}

  updateAccessToken(_accessToken: string): void {}

  async connect(): Promise<void> {
    const deferred = this.nextConnect;
    this.nextConnect = undefined;
    await deferred?.promise;

    if (this.connectError !== undefined) {
      throw this.connectError;
    }

    this.setConnected(true);
  }

  async disconnect(): Promise<void> {
    this.handlerMap.clear();
    this.setConnected(false);
  }

  async subscribeDevice(
    did: string,
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<void> {
    this.handlerMap.set(did, handler);
  }

  async unsubscribeDevice(did: string): Promise<void> {
    this.unsubscribeCalls.push(did);
    const deferred = this.nextUnsubscribe;
    this.nextUnsubscribe = undefined;
    await deferred?.promise;
    this.handlerMap.delete(did);
  }

  addConnectionStateListener(
    listener: CloudMqttConnectionStateListener,
  ): () => void {
    this.connectionStateListenerSet.add(listener);

    return () => {
      this.connectionStateListenerSet.delete(listener);
    };
  }

  deferNextUnsubscribe(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.nextUnsubscribe = deferred;
    return deferred;
  }

  deferNextConnect(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.nextConnect = deferred;
    return deferred;
  }

  requireHandler(did: string): CloudMqttDeviceMessageHandler {
    const handler = this.handlerMap.get(did);

    if (handler === undefined) {
      throw new Error(`Missing test cloud handler for ${did}.`);
    }

    return handler;
  }

  emitProperty(did: string, value: number): void {
    this.requireHandler(did)(createPropertyMessage(did, value));
  }

  setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }

    this.connected = connected;

    for (const listener of this.connectionStateListenerSet) {
      listener(connected);
    }
  }
}

class TestLocalMessageRouter implements RoutedLocalMessageSource {
  private readonly routeMap = new Map<string, TestLocalPropertySource>();

  private readonly connectionStateListenerSet = new Set<
    (connected: boolean) => void
  >();

  private readonly routesChangedListenerSet = new Set<() => void>();

  private connectedValue = false;

  constructor(private readonly connectError?: Error) {}

  get connected(): boolean {
    return this.connectedValue;
  }

  async connect(): Promise<void> {
    if (this.connectError !== undefined) {
      throw this.connectError;
    }

    this.setConnected(true);
  }

  async disconnect(): Promise<void> {
    this.setConnected(false);
  }

  addConnectionStateListener(
    listener: (connected: boolean) => void,
  ): () => void {
    this.connectionStateListenerSet.add(listener);

    return () => {
      this.connectionStateListenerSet.delete(listener);
    };
  }

  addRoutesChangedListener(listener: () => void): () => void {
    this.routesChangedListenerSet.add(listener);

    return () => {
      this.routesChangedListenerSet.delete(listener);
    };
  }

  getMessageSource(did: string): LocalDeviceMessageSource | undefined {
    return this.routeMap.get(did);
  }

  setRoute(did: string, source: TestLocalPropertySource): void {
    this.routeMap.set(did, source);
    this.notifyRoutesChanged();
  }

  removeRoute(did: string): void {
    this.routeMap.delete(did);
    this.notifyRoutesChanged();
  }

  private setConnected(connected: boolean): void {
    if (this.connectedValue === connected) {
      return;
    }

    this.connectedValue = connected;

    for (const listener of this.connectionStateListenerSet) {
      listener(connected);
    }
  }

  private notifyRoutesChanged(): void {
    for (const listener of this.routesChangedListenerSet) {
      listener();
    }
  }
}

class TestLocalPropertySource implements LocalDeviceMessageSource {
  private listener:
    ((update: MiotProperty & {readonly value: unknown}) => void) | undefined;

  private nextDispose: Deferred<void> | undefined;

  private nextEventSubscription: Deferred<void> | undefined;

  private eventListener:
    | ((update: {
        readonly did: string;
        readonly siid: number;
        readonly eiid: number;
        readonly arguments: readonly unknown[];
      }) => void)
    | undefined;

  disposeCalls = 0;

  get hasEventListener(): boolean {
    return this.eventListener !== undefined;
  }

  async subscribeProperties(
    _did: string,
    listener: (update: MiotProperty & {readonly value: unknown}) => void,
  ): Promise<{dispose(): Promise<void>}> {
    this.listener = listener;

    return {
      dispose: async () => {
        this.disposeCalls++;
        const deferred = this.nextDispose;
        this.nextDispose = undefined;
        await deferred?.promise;
        this.listener = undefined;
      },
    };
  }

  async subscribeEvents(
    _did: string,
    listener: (update: {
      readonly did: string;
      readonly siid: number;
      readonly eiid: number;
      readonly arguments: readonly unknown[];
    }) => void,
  ): Promise<{dispose(): Promise<void>}> {
    this.eventListener = listener;
    const deferred = this.nextEventSubscription;
    this.nextEventSubscription = undefined;

    try {
      await deferred?.promise;
    } catch (error) {
      this.eventListener = undefined;
      throw error;
    }

    return {
      dispose: async () => {
        this.eventListener = undefined;
      },
    };
  }

  deferNextDispose(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.nextDispose = deferred;
    return deferred;
  }

  deferNextEventSubscription(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.nextEventSubscription = deferred;
    return deferred;
  }

  requireListener(): (
    update: MiotProperty & {readonly value: unknown},
  ) => void {
    if (this.listener === undefined) {
      throw new Error('Missing test local property listener.');
    }

    return this.listener;
  }

  emitProperty(did: string, value: number): void {
    this.requireListener()(createPropertyUpdate(did, value));
  }

  emitEvent(did: string, value: number): void {
    this.emitEventArguments(did, [value]);
  }

  emitEventArguments(did: string, eventArguments: readonly unknown[]): void {
    this.eventListener?.({
      did,
      siid: 3,
      eiid: 1,
      arguments: eventArguments,
    });
  }

  emitIdentifiedEvent(did: string, value: number): void {
    this.eventListener?.({
      did,
      siid: 3,
      eiid: 1,
      arguments: [{piid: 2, value}],
    });
  }
}

function createPropertyMessage(
  did: string,
  value: number,
): CloudMqttDeviceMessage {
  return {type: 'property-change', data: createPropertyUpdate(did, value)};
}

function createEventMessage(
  did: string,
  value: number,
): CloudMqttDeviceMessage {
  return createPositionalEventMessage(did, [value]);
}

function createPositionalEventMessage(
  did: string,
  values: readonly unknown[],
): CloudMqttDeviceMessage {
  return {
    type: 'event',
    data: {
      did,
      siid: 3,
      eiid: 1,
      arguments: {type: 'positional', data: values},
    },
  };
}

function createIdentifiedEventMessage(
  did: string,
  value: number,
): CloudMqttDeviceMessage {
  return {
    type: 'event',
    data: {
      did,
      siid: 3,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 2, value}],
      },
    },
  };
}

function createPropertyUpdate(
  did: string,
  value: number,
): MiotProperty & {readonly value: unknown} {
  return {did, siid: 2, piid: 1, value};
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {promise, resolve, reject};
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Expected condition was not reached.');
}
