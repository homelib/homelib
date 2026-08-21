import {DeviceEntry} from '../../device.js';
import {
  ExecuteSmartSpeakerVoiceCommand,
  SmartSpeaker,
  SmartSpeakerEndpoint,
  type SmartSpeakerEndpointCommand,
  type SmartSpeakerEndpointConnection,
  SpeakSmartSpeakerTextCommand,
} from '../../devices/smart-speaker.js';
import type {CommandExecution} from '../../endpoint.js';

test('chains speech and voice commands through one smart-speaker endpoint', async () => {
  const entry = new DeviceEntry('speaker');
  const speaker = entry.createInstance(SmartSpeaker);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof SmartSpeakerEndpoint)) {
    throw new TypeError('Expected a smart-speaker endpoint.');
  }

  const connection = new TestSmartSpeakerEndpointConnection();
  endpoint.bindConnection(connection);

  expect(speaker.ready).toBe(true);
  expect(speaker.speak('欢迎回家')).toBe(speaker);
  await flushMicrotasks();
  expect(speaker.executeVoiceCommand('关闭客厅灯', {silent: true})).toBe(
    speaker,
  );
  await flushMicrotasks();
  expect(endpoint.executeVoiceCommand('播放音乐')).toBe(endpoint);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SpeakSmartSpeakerTextCommand('欢迎回家'),
    new ExecuteSmartSpeakerVoiceCommand('关闭客厅灯', true),
    new ExecuteSmartSpeakerVoiceCommand('播放音乐', false),
  ]);
});

test('validates text and preserves one-shot command semantics', () => {
  for (const text of ['', '   ']) {
    expect(() => new SpeakSmartSpeakerTextCommand(text)).toThrow(TypeError);
    expect(() => new ExecuteSmartSpeakerVoiceCommand(text, false)).toThrow(
      TypeError,
    );
  }

  expect(() => new SpeakSmartSpeakerTextCommand(undefined as never)).toThrow(
    TypeError,
  );
  expect(
    () => new ExecuteSmartSpeakerVoiceCommand('命令', 'yes' as never),
  ).toThrow(TypeError);

  const first = new SpeakSmartSpeakerTextCommand('重复播报');
  const second = new SpeakSmartSpeakerTextCommand('重复播报');

  expect(first.supersedes(second)).toBe(false);
  expect(second.supersedes(first)).toBe(false);
  expect(first.toLogString()).toBe('speak text="重复播报"');
  expect(
    new ExecuteSmartSpeakerVoiceCommand('播放音乐', true).toLogString(),
  ).toBe('execute voiceCommand="播放音乐" silent=true');
});

class TestSmartSpeakerEndpointConnection implements SmartSpeakerEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly commands: SmartSpeakerEndpointCommand[] = [];

  prepareCommand(command: SmartSpeakerEndpointCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
