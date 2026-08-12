/**
 * homelib API 设计草案
 *
 * 核心理念：把智能家居设备变成可编程的 JS 对象。
 * - 设备对象是 Proxy，即时创建，背后连接 lazy
 * - 属性是 MobX observable，所有可变值默认 observable，无需后缀标记
 * - 方法是状态变更的触发器，协议层异步执行
 * - 首次运行时 TUI 引导配置/绑定
 * - 不约束用户怎么写自动化，交给 JS 生态实践
 *
 * 上一版草稿见 design-draft-query-accessor.md（query/accessor 方向）
 * 和 design-draft-new-device.md（new Device() 方向）
 * 本版探索：$home() + scope + provider 注册 accessor。
 */

import {$home, defineAccessor} from '@homelib/core';
import {xiaomi} from '@homelib/xiaomi';
import {autorun, reaction} from 'mobx';

// ═══════════════════════════════════════════════════════════════
// 1. 层级结构 — $home() → $scope() → $accessor()
// ═══════════════════════════════════════════════════════════════

// homelib 的家对象，非 provider 绑定，提供全局层级结构
const home = $home('my home');

// scope 提供命名空间，避免设备名重复
const livingRoom = home.$scope('living room');
const bedroom = home.$scope('bedroom');

// $light 是设备 accessor，由 provider 或 homelib 注册
// 返回的是 proxy，即时创建，背后连接 lazy
const light = livingRoom.$light('main light');

light.turnOn();

// scope 可以嵌套
const desk = livingRoom.$scope('desk');
const deskLamp = desk.$light('desk lamp');

// ═══════════════════════════════════════════════════════════════
// 2. accessor 注册 — general 抽象 vs provider 特定
// ═══════════════════════════════════════════════════════════════

// homelib 内置 general 抽象（light, sensor, ac, curtain...），
// 用与 provider 相同的 API 注册。
// 任何 provider 的兼容设备（有继承关系的）都能绑定到 general accessor。

// general accessor — 不限定 provider
const light = livingRoom.$light('main light');
//     ^── GeneralLight，有 turnOn/setBrightness 等通用方法

// provider 特定 accessor — 更精确的类型
const xiaomiLight = livingRoom.xiaomi.$light('main light');
//     ^── XiaomiLight，有 Xiaomi 特有方法/属性

// 注意：$home() / $scope() 是 homelib 自己的层级结构，和 provider 无关。
// provider 只注册 accessor 和提供连接，不参与 scope 层级。
// 所以不存在 xiaomi.$home() / xiaomi.$scope()。

// ═══════════════════════════════════════════════════════════════
// 3. 设备绑定 — 首次运行 Web GUI 拖拽匹配
// ═══════════════════════════════════════════════════════════════

// 用户脚本里只写语义路径：livingRoom.$light('main light')
// 首次运行时 homelib 检测到未绑定的设备引用，启动 Web GUI：
//
// ┌─────────────────────────────────────────────────────────────┐
// │  homelib 设备绑定                                           │
// │                                                             │
// │  ┌─ 脚本引用 ──────────┐    ┌─ 可用设备 (xiaomi) ────────┐  │
// │  │                     │    │                            │  │
// │  │  living room        │    │  💡 客厅吊灯               │  │
// │  │  ├─ main light  ◄───�────│  💡 主灯                   │  │
// │  │  └─ ac          ◄──┐    │  💡 吸顶灯                 │  │
// │  │                    │    │  ❄️ 客厅空调               │  │
// │  │  bedroom           │    │  🌡️ 卧室温湿度计          │  │
// │  │  └─ curtain     ◄──┘    │  ...                       │  │
// │  │                    │    │                            │  │
// │  └────────────────────┘    └────────────────────────────┘  │
// │                                                             │
// │  拖拽右侧设备到左侧引用完成绑定                              │
// │  [完成]                                                     │
// └─────────────────────────────────────────────────────────────┘
//
// 左侧：脚本中的语义路径（scope/accessor/name 组成的树）
// 右侧：provider 发现的物理设备列表（带图标、型号、在线状态）
// 操作：拖拽右侧设备 → 左侧引用，完成绑定
//
// 绑定结果持久化到 ~/.homelib/bindings.json：
//   { "living room/main light": { provider: "xiaomi", did: "123456" } }
//
// 后续运行自动加载绑定，无需再次交互。
// 设备改名/换设备时重新绑定即可。
// 也可以随时运行 homelib bind 命令重新打开 GUI 修改绑定。

// ═══════════════════════════════════════════════════════════════
// 4. 状态读取 — MobX observable
// ═══════════════════════════════════════════════════════════════

// 所有可变值默认都是 observable，无需后缀标记
autorun(() => {
  console.log(`${light.name} is ${light.on ? 'on' : 'off'}`);
});

// 连接状态也是 observable
autorun(() => {
  // 'pending' | 'connecting' | 'ready' | 'offline' | 'error'
  console.log('connection:', light.status);
});

// ═══════════════════════════════════════════════════════════════
// 5. 控制 — 方法是状态变更触发器，不是协议命令
// ═══════════════════════════════════════════════════════════════

// 方法调用 = 设置目标状态，同步、确定性、不失败
// 协议层异步同步，离线 queue，恢复后自动 sync，失败回滚 + error 事件
light.turnOn();
light.setBrightness(80);

// ═══════════════════════════════════════════════════════════════
// 6. 自动化 — 纯 JS 实践，homelib 不约束
// ═══════════════════════════════════════════════════════════════

const motionSensor = livingRoom.$sensor('motion sensor');

reaction(
  () => motionSensor.motion,
  motion => {
    if (motion) {
      light.turnOn();
    }
  },
);

autorun(() => {
  if (light.on && light.brightness < 50) {
    light.setBrightness(100);
  }
});

// 用户自定义"场景"就是普通函数
function movieScene() {
  livingRoom.$light('main light').setBrightness(10);
  livingRoom.$airConditioner('air conditioner').turnOn();
  bedroom.$curtain('curtain').close();
}

// ═══════════════════════════════════════════════════════════════
// 7. 首次运行 — provider 配置 + 设备绑定
// ═══════════════════════════════════════════════════════════════

// 用户第一次执行脚本时，homelib 检测到需要配置的 provider：
//
// ┌─ homelib 初始化 ──────────────────────────────┐
// │                                              │
// │  脚本使用了以下服务：                         │
// │                                              │
// │  ◉ Xiaomi (小米)              [未配置]       │
// │    需要 OAuth 登录授权                        │
// │                                              │
// │  ─────────────────────────────────────       │
// │  ↑↓ 选择  空格 标记  回车 确认                │
// │                                              │
// └──────────────────────────────────────────────┘
//
// 选择 Xiaomi 后：
// 1. 选择区域 (CN / DE / SG / ...)
// 2. 浏览器打开 OAuth 授权页
// 3. 本地 HTTP server 接收回调
// 4. 获取 token，缓存到 ~/.homelib/
// 5. 拉取设备列表
//
// 然后逐个绑定脚本中引用的设备（见第 3 节）
// 配置完成后脚本继续执行，后续运行直接读缓存

// ═══════════════════════════════════════════════════════════════
// 8. Provider 开发者视角 — 注册 accessor
// ═══════════════════════════════════════════════════════════════

// @homelib/xiaomi 开发者注册 provider 特定 accessor：
//
//   class XiaomiLight extends Light {  // 继承 homelib 内置 GeneralLight
//     // Xiaomi 特有属性/方法
//     colorTemperature = observable(2700);
//     setColorTemperature(k: number) { this.colorTemperature = k; }
//
//     async sync(conn: XiaomiConnection, target) { ... }
//   }
//
//   defineAccessor('xiaomi', 'light', {
//     type: XiaomiLight,
//     match: (device) => device.urn.includes('light'),
//   });
//
// homelib 内置 general 抽象，用相同 API 注册：
//
//   class Light extends Device {
//     on = observable(false);
//     brightness = observable(0);
//     turnOn() { this.on = true; }
//     turnOff() { this.on = false; }
//     setBrightness(v: number) { this.brightness = v; }
//   }
//
//   defineAccessor('general', 'light', {
//     type: Light,
//     match: (device) => device.capabilities.includes('on-off'),
//   });
//
// 继承关系：XiaomiLight extends Light extends Device
// 运行时多一层信息：general accessor 返回的是 Light 实例，
// 但实际绑定的可能是 XiaomiLight（provider 特定类型）。
// 用户通过 livingRoom.xiaomi.$light() 可以拿到更精确的 XiaomiLight。
// scope proxy 在运行时将 $light 映射到注册的函数。
// livingRoom.$light → general light accessor
// livingRoom.xiaomi.$light → xiaomi light accessor

// ═══════════════════════════════════════════════════════════════
// 9. 设备对象 — action queue + remote state
// ═══════════════════════════════════════════════════════════════

// 状态只有一个来源：设备实际报告的 remote state
// 方法调用只是往 action queue 里塞操作，不碰状态
// 没有乐观值、没有回滚、没有 target/current 分裂
// light.on 永远是设备说的那个值
//
//   light.turnOn()
//        → action queue: [set on=true]
//              ↓ 协议层执行（local-mqtt > lan > cloud）
//   设备执行后通过 MQTT 推送状态变化
//              ↓
//   light.on = true  ← remote state 更新
//
// 离线时 action 留在 queue 中，连接恢复后自动执行
// action 失败只记录 error，不回滚状态（因为没有乐观值）
// 多端操作时，各端都只反映设备实际状态，冲突由设备自身仲裁

light.turnOn();
// 此刻 light.on 仍是旧值，直到设备推送状态变化
// 这是"最终一致"而非"乐观"的模型

// ═══════════════════════════════════════════════════════════════
// 10. 事件
// ═══════════════════════════════════════════════════════════════

// 设备事件通过 observable 暴露
autorun(() => {
  const event = light.lastEvent;
  if (event) {
    console.log('event:', event.type, event.params);
  }
});

// 也可以用传统事件监听
light.on('error', err => {
  console.error('device error:', err);
});

// ═══════════════════════════════════════════════════════════════
// 11. 设备集合 — $$accessor() 批量操作
// ═══════════════════════════════════════════════════════════════

// // $$ 前缀 = 集合 accessor，不带 name，返回该 scope 下所有匹配设备
// livingRoom.$$light().turnOn(); // 客厅所有灯
// bedroom.$$device().turnOff(); // 卧室所有设备关

const lights = livingRoom.$$light('light group');

// 遍历
for (const light of lights) {
  light.turnOn();
}

// ═══════════════════════════════════════════════════════════════
// 12. 设备开发 utilities — 功能积木，不混入主设计
// ═══════════════════════════════════════════════════════════════

// 成熟 IoT 协议（Matter、HomeKit、Zigbee...）都把功能拆成小的功能单元：
//
//   Matter:     cluster (功能簇) → attributes / commands / events
//   HomeKit:    service → characteristics
//   Zigbee:     cluster
//   MIoT:       service (siid) → property (piid) / action (aiid)
//
// 这些概念是构建设备类的积木，属于设备开发者工具层，
// 不出现在用户 API 中。用户只看到 light.turnOn()。
//
// homelib/core 在 utilities 中提供这些积木：

// ── Cluster / Service / Trait — 功能单元的抽象 ───────────────
//
//   import {Cluster, Device} from '@homelib/core';
//
//   // 设备开发者用 Cluster 组合功能，不用手写每个属性/方法
//   class OnOffCluster extends Cluster {
//     // Matter On/Off cluster 的标准定义
//     on = attribute(false);
//     turnOn = command(() => { this.on = true; });
//     turnOff = command(() => { this.on = false; });
//   }
//
//   class LevelControlCluster extends Cluster {
//     // Matter Level Control cluster
//     currentLevel = attribute(0);
//     moveToLevel = command((level: number) => { this.currentLevel = level; });
//   }
//
//   class ColorControlCluster extends Cluster {
//     hue = attribute(0);
//     saturation = attribute(0);
//     setColor = command((h: number, s: number) => { this.hue = h; this.saturation = s; });
//   }

// ── 设备类用 Cluster 组合 ─────────────────────────────────────
//
//   class Light extends Device {
//     onoff = use(OnOffCluster);
//     level = use(LevelControlCluster);
//     color = use(ColorControlCluster);
//
//     // 语义方法 — 组合 cluster 的能力
//     turnOn() { this.onoff.turnOn(); }
//     turnOff() { this.onoff.turnOff(); }
//     setBrightness(v: number) { this.level.moveToLevel(v); }
//     setColor(c: {hue: number, saturation: number}) { this.color.setColor(c.hue, c.saturation); }
//
//     // observable 暴露 — 代理 cluster attributes
//     get on() { return this.onoff.on; }
//     get brightness() { return this.level.currentLevel; }
//   }
//
//   class XiaomiLight extends Light {
//     // Xiaomi 特有：色温
//     colorTemperature = attribute(2700);
//     setColorTemperature(k: number) { this.colorTemperature = k; }
//
//     async sync(conn: XiaomiConnection, target) {
//       // 将 cluster 状态映射到 MIoT spec 的 siid/piid
//       if (target.on !== undefined) await conn.setProperty(2, 1, target.on);
//       if (target.brightness !== undefined) await conn.setProperty(2, 2, target.brightness);
//     }
//   }

// ── MIoT Spec 映射 ────────────────────────────────────────────
//
//   // xiaomi provider 可以提供 MIoT spec → cluster 的映射工具
//   import {miotSpec} from '@homelib/xiaomi';
//
//   // 从 MIoT spec 自动生成 cluster
//   const onoff = miotSpec.cluster(2, {  // siid=2 (switch)
//     on: {piid: 1},
//     turnOn: {aiid: 1},
//     turnOff: {aiid: 2},
//   });
//
//   // 或者从 spec URL 自动推导
//   const clusters = miotSpec.fromUrn('urn:miot-spec:light:0000A001:1');

// ── 设计原则 ──────────────────────────────────────────────────
//
// 1. Cluster / Service / Trait 是设备开发者的积木，用户不可见
// 2. homelib/core 提供 Cluster 基类和 attribute/command/event 工具
// 3. provider 可以提供自己的 cluster 映射工具（如 miotSpec）
// 4. 设备类用 cluster 组合功能，再暴露语义化的方法和属性
// 5. 不同协议的 cluster 概念可以统一到同一套 utilities
//    Matter cluster / MIoT service / HomeKit service → homelib Cluster
