import {X509Certificate, randomInt} from 'node:crypto';
import type {ConnectionOptions} from 'node:tls';

import {type IClientOptions, type MqttClient, connectAsync} from 'mqtt';

import {
  MiotEndpointConnectionTransport,
  MiotEndpointConnectionTransportUnavailableError,
} from '../endpoint-connection/index.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotInvokeActionRequest,
  type MiotProperty,
  MiotSetPropertyRequest,
} from '../miot/index.js';

import {isMipsGatewayCertificate} from './certificate.js';
import {decodeMipsMessage, encodeMipsMessage} from './message.js';

const DEFAULT_PORT = 8883;
const KEEPALIVE_SECONDS = 60;
const CONNECT_TIMEOUT_MILLISECONDS = 10_000;
const RECONNECT_INTERVAL_MILLISECONDS = 6_000;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const UINT32_RANGE = 0x1_0000_0000;
const MQTT_QOS = 2;

export class LocalMqttClient extends MiotEndpointConnectionTransport {
  private mqttClient: MqttClient | undefined;

  private connectPromise: Promise<void> | undefined;

  private readyOperation:
    | {
        readonly generation: number;
        readonly promise: Promise<void>;
      }
    | undefined;

  private readyRetryTimeout: ReturnType<typeof setTimeout> | undefined;

  private activeConnectionGeneration: number | undefined;

  private nextConnectionGeneration = 0;

  private operationGeneration = 0;

  private ready = false;

  private nextMessageId = randomInt(UINT32_RANGE);

  private readonly pendingRequestMap = new Map<number, PendingRequest>();

  private readonly propertyListenerMap = new Map<
    string,
    Set<LocalPropertyListenerEntry>
  >();

  private readonly eventListenerMap = new Map<
    string,
    Set<LocalEventListenerEntry>
  >();

  private readonly subscribedPropertyDidSet = new Set<string>();

  private readonly subscribedEventDidSet = new Set<string>();

  private readonly deviceListChangedListenerSet =
    new Set<LocalDeviceListChangedListener>();

  private readonly connectionStateListenerSet =
    new Set<LocalMqttConnectionStateListener>();

  private readonly propertyReadQueue: LocalPropertyReadRequest[] = [];

  private readonly eventPropertyReadQueue: LocalPropertyReadRequest[] = [];

  private propertyReadActive = false;

  constructor(private readonly options: LocalMqttClientOptions) {
    super();
    validateOptions(options);
  }

  get connected(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (this.ready) {
      return;
    }

    let connectPromise = this.connectPromise;

    if (connectPromise === undefined) {
      connectPromise = this.ensureConnected(this.operationGeneration);
      this.connectPromise = connectPromise;
    }

    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.operationGeneration++;
    this.stopReadyRetry();

    const connectPromise = this.connectPromise;

    if (connectPromise !== undefined) {
      await connectPromise.catch(() => undefined);
    }

    this.stopReadyRetry();

    const mqttClient = this.mqttClient;
    this.mqttClient = undefined;
    this.activeConnectionGeneration = undefined;
    this.subscribedPropertyDidSet.clear();
    this.subscribedEventDidSet.clear();
    this.setReady(false);
    this.rejectPendingRequests(
      new LocalMqttRequestInterruptedError(
        'Local MQTT disconnected before a response was received.',
      ),
    );

    if (mqttClient !== undefined) {
      await mqttClient.endAsync(true);
    }
  }

  addConnectionStateListener(
    listener: LocalMqttConnectionStateListener,
  ): () => void {
    this.connectionStateListenerSet.add(listener);

    return () => {
      this.connectionStateListenerSet.delete(listener);
    };
  }

  addDeviceListChangedListener(
    listener: LocalDeviceListChangedListener,
  ): () => void {
    this.deviceListChangedListenerSet.add(listener);

    return () => {
      this.deviceListChangedListenerSet.delete(listener);
    };
  }

  async getDeviceList(
    timeoutMilliseconds = REQUEST_TIMEOUT_MILLISECONDS,
  ): Promise<ReadonlyMap<string, LocalDeviceInfo>> {
    const response = requireRecord(
      await this.request('proxy/getDevList', {}, timeoutMilliseconds),
      'local device list response',
    );
    const deviceList = requireRecord(
      response.devList,
      'local device list response.devList',
    );
    const result = new Map<string, LocalDeviceInfo>();

    for (const [did, value] of Object.entries(deviceList)) {
      validateDid(did);
      const device = requireRecord(value, `local device list entry ${did}`);
      result.set(did, {
        online: readOptionalBoolean(device.online, 'online'),
        specV2Access: readOptionalBoolean(device.specV2Access, 'specV2Access'),
        pushAvailable: readOptionalBoolean(
          device.pushAvailable,
          'pushAvailable',
        ),
      });
    }

    return result;
  }

  async getProperties(
    properties: readonly MiotProperty[],
    timeoutMilliseconds = REQUEST_TIMEOUT_MILLISECONDS,
    priority: LocalPropertyReadPriority = 'normal',
  ): Promise<readonly LocalPropertyResult[]> {
    const queue =
      priority === 'event'
        ? this.eventPropertyReadQueue
        : priority === 'normal'
          ? this.propertyReadQueue
          : undefined;

    if (queue === undefined) {
      throw new TypeError(
        `Unsupported local property read priority: ${priority}.`,
      );
    }

    return new Promise((resolve, reject) => {
      queue.push({properties, timeoutMilliseconds, resolve, reject});
      this.startNextPropertyRead();
    });
  }

  private startNextPropertyRead(): void {
    if (this.propertyReadActive) {
      return;
    }

    const request =
      this.eventPropertyReadQueue.shift() ?? this.propertyReadQueue.shift();

    if (request === undefined) {
      return;
    }

    this.propertyReadActive = true;
    void this.readProperties(request.properties, request.timeoutMilliseconds)
      .then(request.resolve, request.reject)
      .then(() => {
        this.propertyReadActive = false;
        this.startNextPropertyRead();
      });
  }

  private async readProperties(
    properties: readonly MiotProperty[],
    timeoutMilliseconds: number,
  ): Promise<readonly LocalPropertyResult[]> {
    const results: LocalPropertyResult[] = [];

    // The gateway can associate concurrent proxy/get replies incorrectly.
    // Sending one request at a time also preserves duplicates and input order.
    for (const property of properties) {
      validateProperty(property);
      const response = requireRecord(
        await this.request('proxy/get', property, timeoutMilliseconds),
        'local property response',
      );

      if (Object.hasOwn(response, 'value')) {
        results.push({...property, code: 0, value: response.value});
        continue;
      }

      const code = readResponseErrorCode(response);

      if (code === undefined) {
        throw new LocalMqttProtocolError(
          'Local property response has neither a value nor an error code.',
        );
      }

      results.push({...property, code});
    }

    return results;
  }

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    const did =
      request instanceof MiotSetPropertyRequest
        ? request.property.did
        : request.action.did;
    const rpc =
      request instanceof MiotSetPropertyRequest
        ? createSetPropertiesRpc(request, this.allocateMessageId())
        : createInvokeActionRpc(request, this.allocateMessageId());
    const response = requireRecord(
      await this.request('proxy/rpcReq', {
        did,
        rpc,
      }),
      'local command response',
    );

    if (
      request instanceof MiotSetPropertyRequest &&
      Array.isArray(response.result) &&
      response.result.length === 1
    ) {
      const result = requireRecord(
        response.result[0],
        'local command response.result[0]',
      );

      if (result.did !== request.property.did) {
        throw new LocalMqttProtocolError(
          'Local command response has an unexpected device ID.',
        );
      }

      return {code: requireInteger(result.code, 'local command result code')};
    } else if (
      !(request instanceof MiotSetPropertyRequest) &&
      response.result !== undefined
    ) {
      const result = requireRecord(response.result, 'local action response');

      return {code: requireInteger(result.code, 'local action result code')};
    }

    const code = readResponseErrorCode(response);

    if (code === undefined) {
      throw new LocalMqttProtocolError(
        'Local command response has no execution result.',
      );
    }

    return {code};
  }

  async subscribeProperties(
    did: string,
    listener: LocalPropertyListener,
  ): Promise<LocalMqttPropertySubscription> {
    validateDid(did);

    let listenerSet = this.propertyListenerMap.get(did);
    const firstListener = listenerSet === undefined;

    if (listenerSet === undefined) {
      listenerSet = new Set();
      this.propertyListenerMap.set(did, listenerSet);
    }

    const listenerEntry = {listener};
    listenerSet.add(listenerEntry);

    try {
      if (firstListener && this.ready) {
        await this.subscribePropertyDid(did);
      }
    } catch (error) {
      listenerSet.delete(listenerEntry);

      if (listenerSet.size === 0) {
        this.propertyListenerMap.delete(did);
      }

      throw error;
    }

    let disposed = false;

    return {
      dispose: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        await this.removePropertyListener(did, listenerEntry);
      },
    };
  }

  async subscribeEvents(
    did: string,
    listener: LocalEventListener,
  ): Promise<LocalMqttEventSubscription> {
    validateDid(did);

    let listenerSet = this.eventListenerMap.get(did);
    const firstListener = listenerSet === undefined;

    if (listenerSet === undefined) {
      listenerSet = new Set();
      this.eventListenerMap.set(did, listenerSet);
    }

    const listenerEntry = {listener};
    listenerSet.add(listenerEntry);

    try {
      if (firstListener && this.ready) {
        await this.subscribeEventDid(did);
      }
    } catch (error) {
      listenerSet.delete(listenerEntry);

      if (listenerSet.size === 0) {
        this.eventListenerMap.delete(did);
      }

      throw error;
    }

    let disposed = false;

    return {
      dispose: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        await this.removeEventListener(did, listenerEntry);
      },
    };
  }

  private async ensureConnected(operationGeneration: number): Promise<void> {
    let mqttClient = this.mqttClient;

    if (mqttClient === undefined) {
      mqttClient = await this.createConnection(operationGeneration);
    }

    this.assertOperationGeneration(operationGeneration);
    await this.waitUntilConnected(mqttClient);
    this.assertOperationGeneration(operationGeneration);
    const generation = this.startConnectionSession(mqttClient);
    try {
      await this.markReady(mqttClient, generation);
    } catch (error) {
      this.scheduleReadyRetry(mqttClient, generation);
      throw error;
    }

    this.assertOperationGeneration(operationGeneration);
    this.assertActiveConnectionSession(mqttClient, generation);
  }

  private async createConnection(
    operationGeneration: number,
  ): Promise<MqttClient> {
    const connector = this.options.connector ?? defaultConnector;
    const mqttClient = await connector(
      getBrokerUrl(this.options.host, this.options.port ?? DEFAULT_PORT),
      createMqttOptions(this.options),
    );

    if (this.operationGeneration !== operationGeneration) {
      await mqttClient.endAsync(true);
      throw new Error('Local MQTT connection was cancelled.');
    }

    this.mqttClient = mqttClient;
    mqttClient.on('connect', () => {
      if (this.mqttClient !== mqttClient || !mqttClient.connected) {
        return;
      }

      const generation = this.startConnectionSession(mqttClient);
      void this.markReady(mqttClient, generation).catch(error => {
        if (this.isActiveConnectionSession(mqttClient, generation)) {
          console.error(error);
          this.scheduleReadyRetry(mqttClient, generation);
        }
      });
    });
    mqttClient.on('message', (topic, payload) => {
      this.handleMessage(topic, payload);
    });
    mqttClient.on('close', () => {
      if (this.mqttClient !== mqttClient) {
        return;
      }

      this.activeConnectionGeneration = undefined;
      this.stopReadyRetry();
      this.subscribedPropertyDidSet.clear();
      this.subscribedEventDidSet.clear();
      this.setReady(false);
      this.rejectPendingRequests(
        new LocalMqttRequestInterruptedError(
          'Local MQTT connection closed before a response was received.',
        ),
      );
    });
    mqttClient.on('error', error => {
      if (this.mqttClient === mqttClient) {
        console.error(error);
      }
    });

    return mqttClient;
  }

  private async markReady(
    mqttClient: MqttClient,
    generation: number,
  ): Promise<void> {
    this.assertActiveConnectionSession(mqttClient, generation);

    if (this.ready) {
      return;
    }

    let readyOperation = this.readyOperation;

    if (
      readyOperation === undefined ||
      readyOperation.generation !== generation
    ) {
      readyOperation = {
        generation,
        promise: this.restoreSubscriptions(mqttClient, generation),
      };
      this.readyOperation = readyOperation;
    }

    try {
      await readyOperation.promise;
      this.assertActiveConnectionSession(mqttClient, generation);
      this.setReady(true);
    } finally {
      if (this.readyOperation === readyOperation) {
        this.readyOperation = undefined;
      }
    }
  }

  private scheduleReadyRetry(mqttClient: MqttClient, generation: number): void {
    if (
      this.readyRetryTimeout !== undefined ||
      !this.isActiveConnectionSession(mqttClient, generation)
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      if (this.readyRetryTimeout === timeout) {
        this.readyRetryTimeout = undefined;
      }

      if (!this.isActiveConnectionSession(mqttClient, generation)) {
        return;
      }

      void this.markReady(mqttClient, generation).catch(error => {
        if (this.isActiveConnectionSession(mqttClient, generation)) {
          console.error(error);
          this.scheduleReadyRetry(mqttClient, generation);
        }
      });
    }, RECONNECT_INTERVAL_MILLISECONDS);
    timeout.unref();
    this.readyRetryTimeout = timeout;
  }

  private stopReadyRetry(): void {
    if (this.readyRetryTimeout === undefined) {
      return;
    }

    clearTimeout(this.readyRetryTimeout);
    this.readyRetryTimeout = undefined;
  }

  private async restoreSubscriptions(
    mqttClient: MqttClient,
    generation: number,
  ): Promise<void> {
    this.setReady(false);
    this.subscribedPropertyDidSet.clear();
    this.subscribedEventDidSet.clear();
    await this.subscribeTopics(
      [this.receiveTopic, 'master/appMsg/devListChange'],
      mqttClient,
      generation,
    );

    while (true) {
      this.assertActiveConnectionSession(mqttClient, generation);
      const dids = [...this.propertyListenerMap.keys()].filter(
        did => !this.subscribedPropertyDidSet.has(did),
      );
      const eventDids = [...this.eventListenerMap.keys()].filter(
        did => !this.subscribedEventDidSet.has(did),
      );

      if (dids.length === 0 && eventDids.length === 0) {
        return;
      }

      await this.subscribeTopics(
        [
          ...dids.map(getPropertyPublishTopic),
          ...eventDids.map(getEventPublishTopic),
        ],
        mqttClient,
        generation,
      );

      for (const did of dids) {
        if (this.propertyListenerMap.has(did)) {
          this.subscribedPropertyDidSet.add(did);
        }
      }

      for (const did of eventDids) {
        if (this.eventListenerMap.has(did)) {
          this.subscribedEventDidSet.add(did);
        }
      }
    }
  }

  private async subscribePropertyDid(did: string): Promise<void> {
    if (this.subscribedPropertyDidSet.has(did)) {
      return;
    }

    const mqttClient = this.mqttClient;
    const generation = this.activeConnectionGeneration;

    if (mqttClient === undefined || generation === undefined) {
      throw new MiotEndpointConnectionTransportUnavailableError(
        'Local MQTT is not connected.',
      );
    }

    await this.subscribeTopics(
      [getPropertyPublishTopic(did)],
      mqttClient,
      generation,
    );
    this.subscribedPropertyDidSet.add(did);
  }

  private async subscribeEventDid(did: string): Promise<void> {
    if (this.subscribedEventDidSet.has(did)) {
      return;
    }

    const mqttClient = this.mqttClient;
    const generation = this.activeConnectionGeneration;

    if (mqttClient === undefined || generation === undefined) {
      throw new MiotEndpointConnectionTransportUnavailableError(
        'Local MQTT is not connected.',
      );
    }

    await this.subscribeTopics(
      [getEventPublishTopic(did)],
      mqttClient,
      generation,
    );
    this.subscribedEventDidSet.add(did);
  }

  private async subscribeTopics(
    topics: readonly string[],
    mqttClient: MqttClient,
    generation: number,
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    this.assertActiveConnectionSession(mqttClient, generation);
    const grants = await mqttClient.subscribeAsync([...topics], {
      qos: MQTT_QOS,
    });
    this.assertActiveConnectionSession(mqttClient, generation);
    const grantedQosMap = new Map(
      grants.map(grant => [grant.topic, grant.qos]),
    );

    for (const topic of topics) {
      if (grantedQosMap.get(topic) !== MQTT_QOS) {
        throw new Error(
          `Local MQTT QoS 2 subscription was rejected: ${topic}.`,
        );
      }
    }
  }

  private async removePropertyListener(
    did: string,
    listenerEntry: LocalPropertyListenerEntry,
  ): Promise<void> {
    const listenerSet = this.propertyListenerMap.get(did);

    if (listenerSet === undefined) {
      return;
    }

    listenerSet.delete(listenerEntry);

    if (listenerSet.size > 0) {
      return;
    }

    this.propertyListenerMap.delete(did);

    if (!this.subscribedPropertyDidSet.delete(did)) {
      return;
    }

    const mqttClient = this.mqttClient;

    if (mqttClient === undefined || !mqttClient.connected) {
      return;
    }

    await mqttClient.unsubscribeAsync(getPropertyPublishTopic(did));
  }

  private async removeEventListener(
    did: string,
    listenerEntry: LocalEventListenerEntry,
  ): Promise<void> {
    const listenerSet = this.eventListenerMap.get(did);

    if (listenerSet === undefined) {
      return;
    }

    listenerSet.delete(listenerEntry);

    if (listenerSet.size > 0) {
      return;
    }

    this.eventListenerMap.delete(did);

    if (!this.subscribedEventDidSet.delete(did)) {
      return;
    }

    const mqttClient = this.mqttClient;

    if (mqttClient === undefined || !mqttClient.connected) {
      return;
    }

    await mqttClient.unsubscribeAsync(getEventPublishTopic(did));
  }

  private request(
    operation: string,
    body: unknown,
    timeoutMilliseconds = REQUEST_TIMEOUT_MILLISECONDS,
  ): Promise<unknown> {
    validateTimeout(timeoutMilliseconds);
    const mqttClient = this.mqttClient;

    if (mqttClient === undefined || !mqttClient.connected || !this.ready) {
      throw new MiotEndpointConnectionTransportUnavailableError(
        'Local MQTT is not connected.',
      );
    }

    const id = this.allocateMessageId();
    const pending = createPendingRequest(
      id,
      operation,
      timeoutMilliseconds,
      error => {
        this.rejectPendingRequest(id, error);
      },
    );
    this.pendingRequestMap.set(id, pending);
    const payload = encodeMipsMessage({
      id,
      from: 'local',
      returnTopic: this.replyTopic,
      payload: JSON.stringify(body),
    });
    let publishPromise: Promise<unknown>;

    try {
      publishPromise = mqttClient.publishAsync(`master/${operation}`, payload, {
        qos: MQTT_QOS,
      });
    } catch (error) {
      this.rejectPendingRequest(
        id,
        new LocalMqttRequestInterruptedError(
          'Local MQTT failed after command publication began.',
          {cause: error},
        ),
      );
      return pending.promise;
    }

    void publishPromise.catch(error => {
      this.rejectPendingRequest(
        id,
        new LocalMqttRequestInterruptedError(
          'Local MQTT failed after command publication began.',
          {cause: error},
        ),
      );
    });

    return pending.promise;
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = decodeMipsMessage(payload);

      if (topic === this.replyTopic) {
        if (message.payload === undefined) {
          this.rejectPendingRequest(
            message.id,
            new LocalMqttProtocolError(
              'Local MQTT response has no JSON payload.',
            ),
          );
          return;
        }

        let value: unknown;

        try {
          value = JSON.parse(message.payload);
        } catch (error) {
          this.rejectPendingRequest(
            message.id,
            new LocalMqttProtocolError(
              'Local MQTT response is not valid JSON.',
              {cause: error},
            ),
          );
          return;
        }

        this.resolvePendingRequest(message.id, value);
        return;
      }

      if (topic === `${this.options.virtualDid}/appMsg/devListChange`) {
        this.handleDeviceListChangedMessage(message.payload);
        return;
      }

      this.handleNotificationMessage(topic, message.payload);
    } catch (error) {
      console.error(error);
    }
  }

  private handleDeviceListChangedMessage(payload: string | undefined): void {
    const message = requireRecord(
      parseJsonPayload(payload, 'local device list change'),
      'local device list change',
    );

    if (!Array.isArray(message.devList)) {
      throw new LocalMqttProtocolError(
        'Local device list change has an invalid devList.',
      );
    }

    const dids = message.devList.map((value, index) => {
      if (typeof value !== 'string') {
        throw new LocalMqttProtocolError(
          `Local device list change devList[${index}] is not a string.`,
        );
      }

      validateDid(value);
      return value;
    });

    for (const listener of this.deviceListChangedListenerSet) {
      try {
        listener(dids);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private handleNotificationMessage(
    topic: string,
    payload: string | undefined,
  ): void {
    const prefix = `${this.options.virtualDid}/appMsg/notify/iot/`;

    if (!topic.startsWith(prefix)) {
      return;
    }

    const parts = topic.slice(prefix.length).split('/');

    if (parts.length !== 3) {
      return;
    }

    const did = parts[0];
    const kind = parts[1];
    const instance = parts[2];

    if (did === undefined || kind === undefined || instance === undefined) {
      return;
    }

    if (kind === 'property') {
      this.handlePropertyNotification(did, instance, payload);
    } else if (kind === 'event') {
      this.handleEventNotification(did, instance, payload);
    }
  }

  private handlePropertyNotification(
    did: string,
    instance: string,
    payload: string | undefined,
  ): void {
    const message = requireRecord(
      parseJsonPayload(payload, 'local property notification'),
      'local property notification',
    );
    const messageDid = requireString(
      message.did,
      'local property notification DID',
    );
    const notificationInstance = resolveNotificationInstance(
      instance,
      message.siid,
      message.piid,
      'local property notification',
    );

    if (notificationInstance === undefined) {
      return;
    }

    const [siid, piid] = notificationInstance;

    if (messageDid !== did) {
      throw new LocalMqttProtocolError(
        'Local property notification does not match its topic.',
      );
    }

    if (!Object.hasOwn(message, 'value')) {
      throw new LocalMqttProtocolError(
        'Local property notification has no value.',
      );
    }

    const listeners = this.propertyListenerMap.get(did);

    if (listeners === undefined) {
      return;
    }

    const update: LocalPropertyUpdate = {
      did,
      siid,
      piid,
      value: message.value,
    };

    for (const {listener} of listeners) {
      try {
        listener(update);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private handleEventNotification(
    did: string,
    instance: string,
    payload: string | undefined,
  ): void {
    const message = requireRecord(
      parseJsonPayload(payload, 'local event notification'),
      'local event notification',
    );
    const messageDid = requireString(
      message.did,
      'local event notification DID',
    );
    const notificationInstance = resolveNotificationInstance(
      instance,
      message.siid,
      message.eiid,
      'local event notification',
    );

    if (notificationInstance === undefined) {
      return;
    }

    const [siid, eiid] = notificationInstance;

    if (messageDid !== did) {
      throw new LocalMqttProtocolError(
        'Local event notification does not match its topic.',
      );
    }

    const eventArguments = message.arguments ?? [];

    if (!Array.isArray(eventArguments)) {
      throw new LocalMqttProtocolError(
        'Local event notification has invalid arguments.',
      );
    }

    const listeners = this.eventListenerMap.get(did);

    if (listeners === undefined) {
      return;
    }

    const update: LocalEventUpdate = {
      did,
      siid,
      eiid,
      arguments: eventArguments,
    };

    for (const {listener} of listeners) {
      try {
        listener(update);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private resolvePendingRequest(id: number, value: unknown): void {
    const pending = this.pendingRequestMap.get(id);

    if (pending === undefined) {
      return;
    }

    this.pendingRequestMap.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(value);
  }

  private rejectPendingRequest(id: number, error: Error): void {
    const pending = this.pendingRequestMap.get(id);

    if (pending === undefined) {
      return;
    }

    this.pendingRequestMap.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectPendingRequests(error: Error): void {
    for (const id of [...this.pendingRequestMap.keys()]) {
      this.rejectPendingRequest(id, error);
    }
  }

  private allocateMessageId(): number {
    const initialId = this.nextMessageId;

    while (this.pendingRequestMap.has(this.nextMessageId)) {
      this.nextMessageId = (this.nextMessageId + 1) % UINT32_RANGE;

      if (this.nextMessageId === initialId) {
        throw new Error('Local MQTT message ID space is exhausted.');
      }
    }

    const id = this.nextMessageId;
    this.nextMessageId = (this.nextMessageId + 1) % UINT32_RANGE;
    return id;
  }

  private startConnectionSession(mqttClient: MqttClient): number {
    if (this.mqttClient !== mqttClient || !mqttClient.connected) {
      throw new Error('Local MQTT is not connected.');
    }

    let generation = this.activeConnectionGeneration;

    if (generation === undefined) {
      generation = ++this.nextConnectionGeneration;
      this.activeConnectionGeneration = generation;
    }

    return generation;
  }

  private isActiveConnectionSession(
    mqttClient: MqttClient,
    generation: number,
  ): boolean {
    return (
      this.mqttClient === mqttClient &&
      this.activeConnectionGeneration === generation &&
      mqttClient.connected
    );
  }

  private assertActiveConnectionSession(
    mqttClient: MqttClient,
    generation: number,
  ): void {
    if (!this.isActiveConnectionSession(mqttClient, generation)) {
      throw new Error('Local MQTT disconnected while subscribing.');
    }
  }

  private assertOperationGeneration(generation: number): void {
    if (this.operationGeneration !== generation) {
      throw new Error('Local MQTT connection operation was cancelled.');
    }
  }

  private waitUntilConnected(mqttClient: MqttClient): Promise<void> {
    if (mqttClient.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Local MQTT connection timed out.'));
      }, CONNECT_TIMEOUT_MILLISECONDS);

      const onConnect = (): void => {
        cleanup();
        resolve();
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        mqttClient.off('connect', onConnect);
      };

      mqttClient.on('connect', onConnect);
    });
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;

    if (ready) {
      this.stopReadyRetry();
    }

    for (const listener of this.connectionStateListenerSet) {
      try {
        listener(ready);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private get receiveTopic(): string {
    return `${this.options.virtualDid}/#`;
  }

  private get replyTopic(): string {
    return `${this.options.virtualDid}/reply`;
  }
}

export type LocalMqttClientOptions = {
  readonly virtualDid: string;
  readonly gatewayDid: string;
  readonly host: string;
  readonly port?: number;
  readonly ca: LocalMqttTlsValue;
  readonly cert: LocalMqttTlsValue;
  readonly key: LocalMqttTlsValue;
  readonly connector?: LocalMqttConnector;
};

export type LocalMqttTlsValue = string | Buffer | string[] | Buffer[];

export type LocalDeviceInfo = {
  readonly online: boolean;
  readonly specV2Access: boolean;
  readonly pushAvailable: boolean;
};

export type LocalPropertyResult = MiotProperty & {
  readonly code: number;
  readonly value?: unknown;
};

type LocalPropertyReadPriority = 'normal' | 'event';

type LocalPropertyReadRequest = {
  readonly properties: readonly MiotProperty[];
  readonly timeoutMilliseconds: number;
  readonly resolve: (results: readonly LocalPropertyResult[]) => void;
  readonly reject: (error: unknown) => void;
};

export type LocalPropertyUpdate = MiotProperty & {
  readonly value: unknown;
};

export type LocalPropertyListener = (update: LocalPropertyUpdate) => void;

export type LocalEventUpdate = {
  readonly did: string;
  readonly siid: number;
  readonly eiid: number;
  readonly arguments: readonly unknown[];
};

export type LocalEventListener = (update: LocalEventUpdate) => void;

export type LocalDeviceListChangedListener = (dids: readonly string[]) => void;

export type LocalMqttConnectionStateListener = (connected: boolean) => void;

export type LocalMqttPropertySubscription = {
  dispose(): Promise<void>;
};

export type LocalMqttEventSubscription = {
  dispose(): Promise<void>;
};

export type LocalMqttConnector = (
  url: string,
  options: IClientOptions,
) => Promise<MqttClient>;

export class LocalMqttProtocolError extends Error {
  override readonly name = 'LocalMqttProtocolError';
}

export class LocalMqttRequestTimeoutError extends Error {
  override readonly name = 'LocalMqttRequestTimeoutError';
}

export class LocalMqttRequestInterruptedError extends Error {
  override readonly name = 'LocalMqttRequestInterruptedError';
}

type PendingRequest = {
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

type LocalPropertyListenerEntry = {
  readonly listener: LocalPropertyListener;
};

type LocalEventListenerEntry = {
  readonly listener: LocalEventListener;
};

function createMqttOptions(options: LocalMqttClientOptions): IClientOptions {
  const mqttOptions: IClientOptions &
    Pick<ConnectionOptions, 'checkServerIdentity'> = {
    clientId: options.virtualDid,
    protocolVersion: 5,
    clean: true,
    keepalive: KEEPALIVE_SECONDS,
    reconnectPeriod: RECONNECT_INTERVAL_MILLISECONDS,
    connectTimeout: CONNECT_TIMEOUT_MILLISECONDS,
    resubscribe: false,
    // Gateways are addressed by their discovered IP, so replace generic host
    // name matching with the expected MIPS service identity for this DID.
    rejectUnauthorized: true,
    checkServerIdentity: (_hostname, certificate) => {
      try {
        if (
          certificate.raw !== undefined &&
          isMipsGatewayCertificate(
            new X509Certificate(certificate.raw),
            options.gatewayDid,
          )
        ) {
          return undefined;
        }
      } catch {
        // Return the fixed identity error below.
      }

      return new Error('Local MQTT gateway certificate identity is invalid.');
    },
    ca: options.ca,
    cert: options.cert,
    key: options.key,
  };

  return mqttOptions;
}

function defaultConnector(
  url: string,
  options: IClientOptions,
): Promise<MqttClient> {
  return connectAsync(url, options, false);
}

function createPendingRequest(
  id: number,
  operation: string,
  timeoutMilliseconds: number,
  onTimeout: (error: LocalMqttRequestTimeoutError) => void,
): PendingRequest {
  let resolvePromise: (value: unknown) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<unknown>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A response timeout may occur while the QoS 2 publish handshake is still
  // pending, so attach a handler immediately and let the caller await it.
  void promise.catch(() => undefined);
  const timeout = setTimeout(() => {
    onTimeout(
      new LocalMqttRequestTimeoutError(
        `Local MQTT ${operation} request ${id} timed out after publication began.`,
      ),
    );
  }, timeoutMilliseconds);

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    timeout,
  };
}

function getBrokerUrl(host: string, port: number): string {
  const formattedHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `mqtts://${formattedHost}:${port}`;
}

function getPropertyPublishTopic(did: string): string {
  return `master/appMsg/notify/iot/${did}/property/#`;
}

function getEventPublishTopic(did: string): string {
  return `master/appMsg/notify/iot/${did}/event/#`;
}

function validateOptions(options: LocalMqttClientOptions): void {
  validateDid(options.virtualDid);
  validateDecimalDid(options.gatewayDid, 'gateway');

  if (
    options.host === '' ||
    /[\s/?#@]/u.test(options.host) ||
    options.host.includes('\0') ||
    ((options.host.includes('[') || options.host.includes(']')) &&
      !/^\[[\da-f:.]+\]$/iu.test(options.host))
  ) {
    throw new TypeError('Invalid local MQTT host.');
  }

  const port = options.port ?? DEFAULT_PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('Invalid local MQTT port.');
  }
}

function validateDecimalDid(did: string, name: string): void {
  if (!/^(?:0|[1-9]\d*)$/u.test(did)) {
    throw new TypeError(`Invalid local MQTT ${name} DID.`);
  }
}

function validateDid(did: string): void {
  if (
    did === '' ||
    did.includes('/') ||
    did.includes('#') ||
    did.includes('+') ||
    did.includes('\0')
  ) {
    throw new TypeError(`Invalid local MQTT device ID: ${did}.`);
  }
}

function validateProperty(property: MiotProperty): void {
  validateDid(property.did);
  requirePositiveInteger(property.siid, 'MIoT property SIID');
  requirePositiveInteger(property.piid, 'MIoT property PIID');
}

function createSetPropertiesRpc(
  request: MiotSetPropertyRequest,
  id: number,
): {
  readonly id: number;
  readonly method: 'set_properties';
  readonly params: readonly [Record<string, unknown>];
} {
  validateProperty(request.property);

  return {
    id,
    method: 'set_properties',
    params: [{...request.property, value: request.value}],
  };
}

function createInvokeActionRpc(
  request: MiotInvokeActionRequest,
  id: number,
): {
  readonly id: number;
  readonly method: 'action';
  readonly params: {
    readonly did: string;
    readonly siid: number;
    readonly aiid: number;
    readonly in: readonly {readonly piid: number; readonly value: unknown}[];
  };
} {
  const {did, siid, aiid} = request.action;

  validateDid(did);
  requirePositiveInteger(siid, 'MIoT action SIID');
  requirePositiveInteger(aiid, 'MIoT action AIID');

  for (const input of request.inputs) {
    requirePositiveInteger(input.piid, 'MIoT action input PIID');
  }

  return {
    id,
    method: 'action',
    params: {did, siid, aiid, in: request.inputs},
  };
}

function validateTimeout(timeoutMilliseconds: number): void {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new TypeError('Invalid local MQTT request timeout.');
  }
}

function parseJsonPayload(payload: string | undefined, name: string): unknown {
  if (payload === undefined) {
    throw new LocalMqttProtocolError(`${name} has no JSON payload.`);
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new LocalMqttProtocolError(`${name} is not valid JSON.`, {
      cause: error,
    });
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalMqttProtocolError(`${name} is not an object.`);
  }

  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new LocalMqttProtocolError(`${name} is not an integer.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  const integer = requireInteger(value, name);

  if (integer <= 0) {
    throw new LocalMqttProtocolError(`${name} is not positive.`);
  }

  return integer;
}

function readNotificationIdentifier(value: unknown): number | undefined {
  // Some central-gateway firmware serializes notification IIDs as decimal
  // JSON strings even though request/response IIDs are numbers.
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }
  } else if (typeof value === 'string' && /^[1-9]\d*$/u.test(value)) {
    const integer = Number(value);

    if (Number.isSafeInteger(integer)) {
      return integer;
    }
  }

  return undefined;
}

function readNotificationTopicInstance(
  instance: string,
): readonly [number, number] | undefined {
  const match = /^([1-9]\d*)\.([1-9]\d*)$/u.exec(instance);

  if (match === null) {
    return undefined;
  }

  const first = readNotificationIdentifier(match[1]);
  const second = readNotificationIdentifier(match[2]);

  return first === undefined || second === undefined
    ? undefined
    : [first, second];
}

function resolveNotificationInstance(
  topicInstance: string,
  firstValue: unknown,
  secondValue: unknown,
  name: string,
): readonly [number, number] | undefined {
  const topic = readNotificationTopicInstance(topicInstance);
  const first = readNotificationIdentifier(firstValue);
  const second = readNotificationIdentifier(secondValue);

  if (topic === undefined) {
    return first === undefined || second === undefined
      ? undefined
      : [first, second];
  }

  if (
    (firstValue !== undefined && first === undefined) ||
    (secondValue !== undefined && second === undefined)
  ) {
    return undefined;
  }

  if (
    (first !== undefined && first !== topic[0]) ||
    (second !== undefined && second !== topic[1])
  ) {
    throw new LocalMqttProtocolError(`${name} does not match its topic.`);
  }

  return topic;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new LocalMqttProtocolError(`${name} is not a string.`);
  }

  return value;
}

function readOptionalBoolean(value: unknown, name: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new LocalMqttProtocolError(
      `Local device list ${name} is not a boolean.`,
    );
  }

  return value;
}

function readResponseErrorCode(
  response: Record<string, unknown>,
): number | undefined {
  if (typeof response.code === 'number' && Number.isInteger(response.code)) {
    return response.code;
  }

  if (response.error === undefined) {
    return undefined;
  }

  const error = requireRecord(response.error, 'local response error');
  return requireInteger(error.code, 'local response error code');
}
