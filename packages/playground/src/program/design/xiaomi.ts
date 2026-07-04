/**
 * @homelib/xiaomi — Xiaomi Light 设备实现 draft
 *
 * 展示 provider 开发者如何：
 * 1. 实现 XiaomiConnection（将 DeviceConnection 映射到 MIoT 协议）
 * 2. 实现 MiotDevice（MIoT 协议适配层，作为 Light 的属性）
 * 3. 继承 homelib 内置 Light，注入 MiotDevice，添加 Xiaomi 特有功能
 */

import {
  type ActionPath,
  type DeviceAction,
  type DeviceConnection,
  Light,
  type PropertyPath,
  attribute,
} from '@homelib/core';
import type {
  type DeviceInfo,
  XiaomiHttpClient,
  XiaomiLanClient,
  XiaomiLocalMqttClient,
} from '@homelib/xiaomi/library';

// ═══════════════════════════════════════════════════════════════
// XiaomiConnection — MIoT 协议连接
// ═══════════════════════════════════════════════════════════════

/**
 * XiaomiConnection 将通用的 DeviceConnection 接口映射到 MIoT 协议。
 *
 * 控制优先级：local-mqtt > lan > cloud
 * 连接管理由 XiaomiProvider 负责，XiaomiConnection 只是一个设备的连接句柄。
 *
 * PropertyPath 在 Xiaomi 中映射为 {service: siid, property: piid}。
 */
export class XiaomiConnection extends DeviceConnection {
  ready = false;

  private did: string;
  private localMqtt: XiaomiLocalMqttClient | null = null;
  private lan: XiaomiLanClient | null = null;
  private cloud: XiaomiHttpClient | null = null;

  /** 当前使用的协议路径 */
  private activePath: 'local-mqtt' | 'lan' | 'cloud' = 'cloud';

  private readyHandlers: (() => void)[] = [];
  private offlineHandlers: (() => void)[] = [];
  private stateHandlers: ((state: Record<string, unknown>) => void)[] = [];

  constructor(options: {
    did: string;
    localMqtt?: XiaomiLocalMqttClient;
    lan?: XiaomiLanClient;
    cloud?: XiaomiHttpClient;
  }) {
    super();
    this.did = options.did;
    this.localMqtt = options.localMqtt ?? null;
    this.lan = options.lan ?? null;
    this.cloud = options.cloud ?? null;

    // 选择最佳可用协议路径
    if (this.localMqtt) {
      this.activePath = 'local-mqtt';
    } else if (this.lan) {
      this.activePath = 'lan';
    } else {
      this.activePath = 'cloud';
    }
  }

  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
    if (this.ready) handler();
  }

  onOffline(handler: () => void): void {
    this.offlineHandlers.push(handler);
  }

  onStateChange(handler: (state: Record<string, unknown>) => void): void {
    this.stateHandlers.push(handler);
  }

  async getProperty(path: PropertyPath): Promise<unknown> {
    const siid = Number(path.service);
    const piid = Number(path.property);
    return this.execute('getProp', () => {
      if (this.activePath === 'local-mqtt' && this.localMqtt) {
        return this.localMqtt.getProp(this.did, siid, piid);
      }
      if (this.activePath === 'lan' && this.lan) {
        return this.lan.getProp(siid, piid);
      }
      if (this.cloud) {
        return this.cloud.getProp(this.did, siid, piid);
      }
      throw new Error('No connection available');
    });
  }

  async setProperty(path: PropertyPath, value: unknown): Promise<void> {
    const siid = Number(path.service);
    const piid = Number(path.property);
    await this.execute('setProp', async () => {
      if (this.activePath === 'local-mqtt' && this.localMqtt) {
        await this.localMqtt.setProp(this.did, siid, piid, value);
        return;
      }
      if (this.activePath === 'lan' && this.lan) {
        await this.lan.setProp(siid, piid, value);
        return;
      }
      if (this.cloud) {
        await this.cloud.setProp(this.did, siid, piid, value);
        return;
      }
      throw new Error('No connection available');
    });
  }

  async callAction(path: ActionPath, params?: unknown[]): Promise<unknown> {
    const siid = Number(path.service);
    const aiid = Number(path.action);
    return this.execute('action', () => {
      if (this.activePath === 'local-mqtt' && this.localMqtt) {
        return this.localMqtt.action(this.did, siid, aiid, params ?? []);
      }
      if (this.cloud) {
        return this.cloud.callAction(this.did, siid, aiid, params ?? []);
      }
      throw new Error('No connection available');
    });
  }

  /**
   * 执行操作，带协议 fallback：
   * local-mqtt 失败 → 尝试 lan → 尝试 cloud
   */
  private async execute(
    op: string,
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return await fn();
    } catch (err) {
      // 尝试 fallback
      if (this.activePath === 'local-mqtt' && this.cloud) {
        this.activePath = 'cloud';
        return this.execute(op, fn);
      }
      throw err;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MiotLight — MIoT 灯设备
// ═══════════════════════════════════════════════════════════════

/**
 * MiotLight 继承 homelib 内置 Light 抽象，实现全部功能。
 *
 * 当前阶段：所有功能直接在 MiotLight 中实现，
 * 不引入 MiotDevice 协议适配层。后续根据实现情况再考虑提取。
 *
 * MIoT Spec 典型映射（灯）：
 *   siid=2 (switch)     piid=1 → on/off
 *   siid=2 (brightness) piid=2 → brightness
 *
 * 实际 siid/piid 因设备型号而异，从 MIoT spec URN 查询。
 */
export class MiotLight extends Light {
  // ── Observable 属性 ─────────────────────────────────────────

  private _on = attribute(false);
  private _brightness = attribute(0);

  get on(): boolean {
    return this._on.get();
  }

  get brightness(): number {
    return this._brightness.get();
  }

  // ── 语义方法 — 往 action queue 塞操作，不碰状态 ─────────────

  turnOn(): void {
    this.enqueue({type: 'set', params: {on: true}});
  }

  turnOff(): void {
    this.enqueue({type: 'set', params: {on: false}});
  }

  setBrightness(value: number): void {
    this.enqueue({type: 'set', params: {brightness: value}});
  }

  // ── MIoT Spec 映射 ──────────────────────────────────────────

  private specMap = {
    on: {siid: 2, piid: 1},
    brightness: {siid: 2, piid: 2},
  };

  // ── execute — 将 action 映射到 MIoT siid/piid ────────────────

  protected async execute(
    connection: DeviceConnection,
    action: DeviceAction,
  ): Promise<void> {
    const conn = connection as XiaomiConnection;
    const {params} = action;

    for (const [key, value] of Object.entries(params)) {
      const mapping = this.specMap[key as keyof typeof this.specMap];
      if (!mapping) continue;

      await conn.setProperty(
        {service: mapping.siid, property: mapping.piid},
        value,
      );
    }
  }

  // ── fetchState — 从 MIoT 拉取完整状态 ────────────────────────

  protected async fetchState(
    connection: DeviceConnection,
  ): Promise<Record<string, unknown>> {
    const conn = connection as XiaomiConnection;
    const state: Record<string, unknown> = {};

    for (const [key, mapping] of Object.entries(this.specMap)) {
      state[key] = await conn.getProperty({
        service: mapping.siid,
        property: mapping.piid,
      });
    }

    return state;
  }
}

// ═══════════════════════════════════════════════════════════════
// Provider 注册 — 将 MiotLight 注册为 'light' accessor
// ═══════════════════════════════════════════════════════════════

import {defineAccessor} from '@homelib/core';

defineAccessor('xiaomi', 'light', {
  type: MiotLight,
  match: (device: DeviceInfo) =>
    device.urn.includes('light') ||
    device.model.includes('light') ||
    device.model.includes('bulb'),
});
