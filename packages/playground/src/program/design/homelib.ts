/**
 * homelib/core — 设备基类与功能积木 draft
 *
 * 这是设备开发者的工具层，用户不直接接触。
 * 用户只看到 design.ts 中的 light.turnOn()。
 */

import {action, autorun, makeObservable, observable} from 'mobx';

// ═══════════════════════════════════════════════════════════════
// Device 基类
// ═══════════════════════════════════════════════════════════════

/**
 * Device 是所有设备类的基类。
 *
 * 模型：action queue + remote state
 *
 * - 状态只有一个来源：设备实际报告的 remote state
 * - 方法调用只是往 action queue 里塞操作，不碰状态
 * - 设备执行后通过协议层推送状态变化 → 更新 observable
 * - 没有乐观值、没有回滚、没有 target/current 分裂
 * - light.on 永远是设备说的那个值
 *
 *   light.turnOn()
 *        → action queue: [set on=true]
 *              ↓ 协议层执行
 *   设备执行后通过 MQTT 推送状态变化
 *              ↓
 *   light.on = true  ← remote state 更新
 *
 * 设备开发者继承 Device，定义：
 * - observable 属性（通过 attribute()）
 * - 语义方法（调用 this.enqueue() 往 action queue 塞操作）
 * - execute() 实现（将 action 映射到协议操作）
 */
export abstract class Device {
  /** 设备语义名称，来自 accessor 调用 */
  readonly name: string;

  /** 绑定的 provider 连接，lazy 设置 */
  protected connection: DeviceConnection | null = null;

  /** 连接状态 */
  status: DeviceStatus = 'pending';

  /** 最近一次错误 */
  error: Error | null = null;

  /** 最近一次事件 */
  lastEvent: DeviceEvent | null = null;

  /** action queue — 串行执行，保证操作顺序 */
  private actionQueue: DeviceAction[] = [];

  /** 是否正在处理队列 */
  private processing = false;

  constructor(name: string) {
    this.name = name;
    makeObservable(this, {
      status: observable,
      error: observable,
      lastEvent: observable,
    });
  }

  /** 绑定到 provider 连接 */
  bind(connection: DeviceConnection): void {
    this.connection = connection;
    this.status = 'connecting';

    // 连接就绪后拉取初始状态 + flush 队列
    connection.onReady(async () => {
      this.status = 'ready';
      await this.refreshState();
      this.processQueue();
    });

    connection.onOffline(() => {
      this.status = 'offline';
    });

    // 订阅设备状态推送（协议层 → 设备对象）
    connection.onStateChange(state => {
      this.applyRemoteState(state);
    });
  }

  /**
   * 设备开发者实现：执行单个 action。
   *
   * 将 action 映射到协议操作（setProperty / callAction 等）。
   * 执行成功后设备会通过 onStateChange 推送状态变化。
   * 执行失败只记录 error，不回滚状态（因为没有乐观值）。
   */
  protected abstract execute(
    connection: DeviceConnection,
    action: DeviceAction,
  ): Promise<void>;

  /**
   * 设备开发者实现：从协议层拉取完整状态。
   * 在连接就绪时调用，用于初始化 observable。
   */
  protected abstract fetchState(
    connection: DeviceConnection,
  ): Promise<Record<string, unknown>>;

  /**
   * 设备开发者调用：往 action queue 塞一个操作。
   *
   * 这是所有语义方法（turnOn, setBrightness...）的底层实现。
   * 语义方法内部调用 this.enqueue({type: 'set', params: {on: true}}) 等。
   *
   * 不修改状态。状态只由 remote state 更新。
   */
  protected enqueue(action: DeviceAction): void {
    this.actionQueue.push(action);
    this.processQueue();
  }

  /** 将协议层返回的状态应用到 observable */
  protected applyRemoteState(state: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(state)) {
      (this as any)[key] = value;
    }
  }

  /** 从协议层拉取完整状态并应用 */
  protected async refreshState(): Promise<void> {
    if (!this.connection) return;
    const state = await this.fetchState(this.connection);
    this.applyRemoteState(state);
  }

  /** 串行处理 action queue */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    if (this.status !== 'ready') return;
    if (!this.connection) return;

    this.processing = true;

    while (this.actionQueue.length > 0) {
      const action = this.actionQueue.shift()!;
      try {
        await this.execute(this.connection, action);
      } catch (err) {
        this.error = err as Error;
        this.emit('error', err);
        // 不回滚状态 — 状态只由 remote state 决定
        // action 失败意味着设备没有执行，状态自然不会变
      }
    }

    this.processing = false;
  }

  // ── 事件系统 ─────────────────────────────────────────────────

  private listeners = new Map<string, Set<(data: unknown) => void>>();

  on(event: string, handler: (data: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  protected emit(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const handler of set) handler(data);
    }
  }
}

/**
 * Action — 设备操作的抽象。
 *
 * 语义方法将自身转换为 action 放入队列。
 * execute() 将 action 映射到协议操作。
 */
export type DeviceAction = {
  /** 操作类型，由设备开发者定义 */
  type: string;
  /** 操作参数 */
  params: Record<string, unknown>;
};

// ═══════════════════════════════════════════════════════════════
// DeviceConnection — 协议连接抽象
// ═══════════════════════════════════════════════════════════════

/**
 * DeviceConnection 是 provider 提供的协议连接。
 *
 * provider 负责创建和管理连接（MQTT、HTTP、UDP 等），
 * 设备通过 connection 与物理设备通信。
 *
 * 连接可以复用 — 一个网关的 MQTT 连接可以被多个设备共享。
 */
export abstract class DeviceConnection {
  /** 连接是否就绪 */
  abstract readonly ready: boolean;

  /** 等待连接就绪 */
  abstract onReady(handler: () => void): void;

  /** 连接断开 */
  abstract onOffline(handler: () => void): void;

  /** 设备状态推送（协议层 → 设备对象） */
  abstract onStateChange(
    handler: (state: Record<string, unknown>) => void,
  ): void;

  /** 读取设备属性 */
  abstract getProperty(path: PropertyPath): Promise<unknown>;

  /** 设置设备属性 */
  abstract setProperty(path: PropertyPath, value: unknown): Promise<void>;

  /** 调用设备动作 */
  abstract callAction(path: ActionPath, params?: unknown[]): Promise<unknown>;
}

/** 属性路径 — 协议无关的寻址方式 */
export type PropertyPath = {
  /** 服务/cluster ID（MIoT siid, Matter endpoint+cluster） */
  service: number | string;
  /** 属性 ID（MIoT piid, Matter attribute） */
  property: number | string;
};

/** 动作路径 */
export type ActionPath = {
  service: number | string;
  action: number | string;
};

// ═══════════════════════════════════════════════════════════════
// attribute — observable 状态字段工具
// ═══════════════════════════════════════════════════════════════

/**
 * attribute 创建一个 observable 状态字段。
 * 设备开发者用它声明设备属性，状态只由 remote state 更新。
 */
export function attribute<T>(initial: T): Attribute<T> {
  const box = observable.box(initial);

  return {
    get value(): T {
      return box.get();
    },
    set value(v: T) {
      box.set(v);
    },
    get() {
      return box.get();
    },
    set(v: T) {
      box.set(v);
    },
  };
}

export type Attribute<T> = {
  value: T;
  get(): T;
  set(v: T): void;
};

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type DeviceStatus =
  | 'pending' // 未绑定
  | 'connecting' // 连接中
  | 'ready' // 连接就绪
  | 'offline' // 离线
  | 'error'; // 错误

export type DeviceEvent = {
  type: string;
  params: Record<string, unknown>;
  timestamp: number;
};

// ═══════════════════════════════════════════════════════════════
// Abstract Light — 最简抽象，功能留给 provider 实现
// ═══════════════════════════════════════════════════════════════

/**
 * Light 是 homelib 内置的通用灯设备抽象。
 *
 * 当前阶段：最简抽象类，只定义接口契约，不含任何实现。
 * 功能（属性、方法、execute、fetchState）由 provider 的具体 Light 实现。
 * 后续根据 provider 实现情况，再考虑是否在 homelib 层增加通用实现。
 */
export abstract class Light extends Device {
  abstract get on(): boolean;
  abstract get brightness(): number;

  abstract turnOn(): void;
  abstract turnOff(): void;
  abstract setBrightness(value: number): void;
}
