import type {DeviceConnection} from './device.js';

export abstract class Provider<TCommand> {
  abstract get deviceConnections(): DeviceConnection<TCommand>[];
}
