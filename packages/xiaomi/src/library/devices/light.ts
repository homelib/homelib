import {Light} from '@homelib/core';

export class MiotLight extends Light<MiotLightCommand> {
  override turnOn(): void {
    this.enqueueCommand({name: 'setOn', value: true});
  }

  override turnOff(): void {
    this.enqueueCommand({name: 'setOn', value: false});
  }
}

export type MiotLightCommand = {
  name: 'setOn';
  value: boolean;
};
