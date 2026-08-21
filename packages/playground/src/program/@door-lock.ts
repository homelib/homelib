import type {DoorLock, SmartSpeaker} from '@homelib/core';
import {whenever} from '@homelib/utils';

export function setupDoorLock(lock: DoorLock, speaker: SmartSpeaker): void {
  whenever(() => lock.ready).then(() =>
    lock.onDoorLockOperation(operation => {
      if (operation.action === 'unlock' && operation.method === 'manual') {
        speaker.speak('记得拿卡');
      }
    }),
  );
}
