import type {CommandExecution} from '@homelib/core';
import {action, computed, observable} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import type {
  MiotEventArgument,
  MiotPropertySchema,
  MiotResolvedSpecProperty,
  MiotSpecEvent,
} from '../miot/index.js';

/**
 * Local safety net clearing a motion detection that no duration update
 * confirmed. It is an independent policy constant, deliberately not derived
 * from the current no-motion-duration value: real devices normally clear
 * motion through duration notifications, and the timer only covers devices
 * that keep reporting events without them.
 */
const MOTION_CLEAR_TIMEOUT = 5 * 60_000;

export abstract class MiotMotionSensorEndpointConnectionBase<
  TSchema extends MiotPropertySchema,
> extends MiotEndpointConnection<never, TSchema> {
  @observable private accessor motionDetectedValue: boolean | undefined;

  private motionClearTimer: ReturnType<typeof setTimeout> | undefined;

  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.ready ? (this.motionDetectedValue ?? false) : undefined;
  }

  protected override isSnapshotProperty(
    name: string,
    _property: MiotResolvedSpecProperty,
  ): boolean {
    return name !== 'no-motion-duration';
  }

  protected override handleEvent(
    name: string,
    _event: MiotSpecEvent,
    _arguments: readonly MiotEventArgument[],
  ): void {
    if (name !== 'motion-detected') {
      throw new TypeError(`Unsupported MIoT motion sensor event: ${name}.`);
    }

    this.setMotionDetected(true);
    this.scheduleMotionClear();
  }

  protected override handlePropertyStateChange(
    name: string,
    value: unknown,
  ): void {
    if (name !== 'no-motion-duration') {
      return;
    }

    // 0 means motion was just detected; a positive value means motion
    // stopped that many minutes ago.
    if (value === 0) {
      this.setMotionDetected(true);
      this.scheduleMotionClear();
    } else {
      this.cancelMotionClear();
      this.setMotionDetected(false);
    }
  }

  protected override handleStateInvalidated(): void {
    this.cancelMotionClear();
    this.setMotionDetected(undefined);
  }

  override dispose(): void {
    this.cancelMotionClear();
  }

  override prepareCommand(_command: never): CommandExecution {
    throw new TypeError('MIoT motion sensor does not support commands.');
  }

  @action
  private setMotionDetected(value: boolean | undefined): boolean {
    if (this.motionDetectedValue === value) {
      return false;
    }

    this.motionDetectedValue = value;
    return true;
  }

  private scheduleMotionClear(): void {
    this.cancelMotionClear();
    this.motionClearTimer = setTimeout(() => {
      this.clearMotionDetection();
    }, MOTION_CLEAR_TIMEOUT);
  }

  @action
  private clearMotionDetection(): void {
    this.motionClearTimer = undefined;

    if (this.setMotionDetected(false)) {
      this.notifyStateChanged();
    }
  }

  private cancelMotionClear(): void {
    if (this.motionClearTimer !== undefined) {
      clearTimeout(this.motionClearTimer);
      this.motionClearTimer = undefined;
    }
  }
}
