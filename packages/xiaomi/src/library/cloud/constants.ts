import type {CloudServer} from '../backend/index.js';

export const DEFAULT_CLOUD_MQTT_HOST = 'ha.mqtt.io.mi.com';

export const CLOUD_MQTT_PORT = 8883;

export const CLOUD_MQTT_KEEPALIVE = 60;

export const CLOUD_MQTT_CONNECT_TIMEOUT = 30_000;

export const CLOUD_MQTT_RECONNECT_INTERVAL = 10_000;

export const CLOUD_MQTT_SUBSCRIPTION_BATCH_SIZE = 300;

export const CLOUD_MQTT_SUBSCRIPTION_BATCH_INTERVAL = 1_000;

export function getCloudMqttHost(cloudServer: CloudServer): string {
  return `${cloudServer}-${DEFAULT_CLOUD_MQTT_HOST}`;
}
