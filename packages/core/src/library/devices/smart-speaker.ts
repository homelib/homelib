import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, type EndpointConnection} from '../endpoint.js';

/** A network-connected speaker that can speak and execute voice commands. */
export class SmartSpeaker extends Device {
  protected readonly endpoint: SmartSpeakerEndpoint;

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(SmartSpeakerEndpoint);
  }

  /** Speaks text without interpreting it as a command. */
  speak(text: string): this {
    this.endpoint.speak(text);
    return this;
  }

  /** Executes text as if it were spoken to the assistant. */
  executeVoiceCommand(
    text: string,
    options: SmartSpeakerVoiceCommandOptions = {},
  ): this {
    this.endpoint.executeVoiceCommand(text, options);
    return this;
  }
}

export class SmartSpeakerEndpoint<
  TConnection extends SmartSpeakerEndpointConnection =
    SmartSpeakerEndpointConnection,
> extends Endpoint<SmartSpeakerEndpointCommand, TConnection> {
  /** Speaks text without interpreting it as a command. */
  speak(text: string): this {
    return this.enqueueCommand(new SpeakSmartSpeakerTextCommand(text));
  }

  /** Executes text as if it were spoken to the assistant. */
  executeVoiceCommand(
    text: string,
    options: SmartSpeakerVoiceCommandOptions = {},
  ): this {
    return this.enqueueCommand(
      new ExecuteSmartSpeakerVoiceCommand(text, options.silent ?? false),
    );
  }
}

export type SmartSpeakerEndpointConnection =
  EndpointConnection<SmartSpeakerEndpointCommand>;

export type SmartSpeakerVoiceCommandOptions = {
  /** Whether the assistant should execute the command without speaking. */
  readonly silent?: boolean;
};

/** A one-shot command; repeated text must be spoken each time. */
export class SpeakSmartSpeakerTextCommand extends Command {
  constructor(readonly text: string) {
    super();
    assertSmartSpeakerText(text);
  }

  override toLogString(): string {
    return `speak text=${JSON.stringify(this.text)}`;
  }
}

/** A one-shot command; repeated directives must be executed each time. */
export class ExecuteSmartSpeakerVoiceCommand extends Command {
  constructor(
    readonly text: string,
    readonly silent: boolean,
  ) {
    super();
    assertSmartSpeakerText(text);

    if (typeof silent !== 'boolean') {
      throw new TypeError('Smart speaker silent execution must be boolean.');
    }
  }

  override toLogString(): string {
    return `execute voiceCommand=${JSON.stringify(this.text)} silent=${this.silent}`;
  }
}

export type SmartSpeakerEndpointCommand =
  SpeakSmartSpeakerTextCommand | ExecuteSmartSpeakerVoiceCommand;

function assertSmartSpeakerText(text: string): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('Smart speaker text must be a non-empty string.');
  }
}
