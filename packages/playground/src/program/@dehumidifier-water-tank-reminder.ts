import {
  type Dehumidifier,
  type Light,
  type SmartSpeaker,
  autorun,
} from '@homelib/core';
import {createHeartbeat} from '@homelib/utils';
import ms from 'ms';

export function setupDehumidifierWaterTankReminder({
  lights,
  dehumidifier,
  speaker,
}: {
  lights: Light[];
  dehumidifier: Dehumidifier;
  speaker: SmartSpeaker;
}): void {
  const heartbeat = createHeartbeat(ms('15m'));

  autorun(() => {
    if (!dehumidifier.ready || !speaker.ready) {
      return;
    }

    // 多组灯（大概是大小灯）任意未开，说明客厅大概没人（单开一般是留灯），不提醒。
    if (lights.some(light => !light.on)) {
      return;
    }

    if (dehumidifier.waterTankFull) {
      speaker.speak('客厅除湿机水箱已满，请及时清空水箱。');
      heartbeat();
    }
  });
}
