import type {BackendClient} from '../backend/index.js';
import type {MiotProperty} from '../miot/index.js';

import {
  CloudDeviceChannel,
  type CloudDeviceObserver,
  type CloudDeviceSubscription,
} from './device.js';
import {CloudMqttClient} from './mqtt.js';

export class CloudClient {
  private readonly backendClient: BackendClient;

  private readonly mqttClient: CloudMqttClient;

  private readonly deviceChannelMap = new Map<string, CloudDeviceChannel>();

  constructor(backendClient: BackendClient) {
    this.backendClient = backendClient;
    this.mqttClient = new CloudMqttClient({
      uuid: backendClient.uuid,
      accessToken: backendClient.accessToken,
      cloudServer: backendClient.cloudServer,
    });
    this.mqttClient.observeConnectionState(connected => {
      for (const channel of this.deviceChannelMap.values()) {
        channel.handleConnectionState(connected);
      }
    });
  }

  updateAccessToken(accessToken: string): void {
    this.backendClient.updateAccessToken(accessToken);
    this.mqttClient.updateAccessToken(accessToken);
  }

  async connect(): Promise<void> {
    await this.mqttClient.connect();
  }

  async disconnect(): Promise<void> {
    await this.mqttClient.disconnect();
  }

  async subscribeDevice(
    did: string,
    properties: readonly MiotProperty[],
    observer: CloudDeviceObserver,
  ): Promise<CloudDeviceSubscription> {
    let channel = this.deviceChannelMap.get(did);

    if (channel === undefined) {
      const newChannel = new CloudDeviceChannel(
        did,
        this.mqttClient,
        requestedProperties =>
          this.backendClient.getProperties(requestedProperties),
        () => {
          if (this.deviceChannelMap.get(did) === newChannel) {
            this.deviceChannelMap.delete(did);
          }
        },
      );
      channel = newChannel;
      this.deviceChannelMap.set(did, channel);
    }

    return channel.subscribe(properties, observer);
  }
}
