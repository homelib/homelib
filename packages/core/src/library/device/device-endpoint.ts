export abstract class DeviceEndpoint {
  abstract dispose(): Promise<void> | void;
}
