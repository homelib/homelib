import {DeviceConnection} from '@homelib/core';

export class MiotDeviceConnection<TCommand> extends DeviceConnection<TCommand> {
  override get online(): boolean {
    throw new Error('Method not implemented.');
  }

  override processCommand(command: TCommand): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

export abstract class MiotDeviceConnectionTransport {}
