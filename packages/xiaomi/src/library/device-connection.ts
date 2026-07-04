import {DeviceConnection} from '@homelib/core';

export class MiotDeviceConnection extends DeviceConnection<never> {
  override get id(): string {
    throw new Error('Method not implemented.');
  }

  override get online(): boolean {
    throw new Error('Method not implemented.');
  }

  override processCommand(command: never): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

export abstract class MiotDeviceConnectionTransport {}
