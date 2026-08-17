---
name: device-development
description: '开发与维护 HomeLib device 及任意 provider 适配。Use when: 新增或修改 Device、Endpoint、EndpointConnection、设备命令或状态、协议 schema、设备注册与相关测试。'
---

# Device 开发

## 流程

### 1. 调研设备

- 阅读最接近的 core device、provider 适配和测试，再决定边界与命名。
- 先用目标 provider 的真实 metadata、官方协议和已验证行为确认设备语义。
- 新增设备或调整模型边界、能力拆分、命名时，同时参考 MIoT、Matter 和 Home Assistant 的官方设备模型；它们是交叉参考，不预设目标 provider 或协议。
- 根据真实设备 metadata、官方 spec 和已验证行为建模，不要根据协议标识名称（例如 URN）或相似型号猜测语义，也不要为了对齐某一个生态而照搬其模型。
- 对非标准、型号特有或与官方 spec 不一致的行为，在代码注释或测试 fixture 中记录证据来源与适用范围。
- 第一版只实现当前明确需要且已验证的能力。

### 2. 定义 core 模型

- 在 `packages/core/src/library/devices` 中保持 Device、Endpoint、EndpointConnection 和 Command 与具体协议无关。
- 让 Device 聚合 Endpoint，Endpoint 暴露状态与命令，EndpointConnection 声明 provider 连接契约，Command 校验领域输入。
- 补充 namespace/index 导出和对应单元测试。

### 3. 实现 provider 适配

- 在目标 provider package 中实现 core EndpointConnection，并沿用该 provider 现有的连接、schema、导出和注册结构。
- 对 Xiaomi MIoT，继承 `MiotEndpointConnection`，定义 `static readonly Endpoint`，并让 properties、actions、events 使用 `as const satisfies ...Schema`。
- 明确 required/optional 能力；资源缺失、重复或歧义时 fail closed。
- 实现状态映射和命令请求，补充对应导出与注册入口。

### 4. MIoT 物理域与设备 codec

- property schema 只按 URN、IID、access 匹配物理属性；`value-list` override 只修正物理 raw domain。resolved property 保留 spec 物理信息，不携带 core named state 或 sentinel 语义。
- 把 raw 与 core domain 的 named state、sentinel 双向映射放在具体 device 拥有的 typed codec 中；型号差异也由该 codec 按完整 device URN 选择。
- 具体 `MiotEndpointConnection` 通过 `getPropertyValueCodec(alias, definition)` 把 codec 绑定到 resolved property、完整 device URN 和对应 raw state；状态读取与命令编码复用该 connection-bound codec，不要在调用点自行拼装 resolve context 或把 codec 用到其他 alias 的 raw state。
- decode 遇到物理 domain 内合法但 codec 未映射的 raw 状态时返回 `undefined`，且不影响 endpoint ready。
- encode 必须生成 canonical raw，并按 resolved property 的物理 domain 校验；缺少适用映射或 raw 不合法时 fail closed。
- `MiotCommandEffect` 只接收 codec 已生成的 canonical raw，不解释 core domain，也不选择型号映射。

### 5. MIoT URN pattern 使用字面量

- 在声明或业务匹配位置，把每个具体 URN pattern 的整个表达式写成一个字符串字面量。
- 该规则适用于 schema key、action `in`/`out`、`iid`/`value-list` selector、device codec/model mapping selector，以及 `matchesMiotUrnPattern` 等 matcher 的 pattern 实参。
- 不要把 pattern 提取为常量，不要拼接、插值或通过辅助函数构造；同一 pattern 出现多次时直接重复字面量，这是为局部可读性与可搜索性主动接受的取舍。
- prefix、`*` 和逗号分隔 alternatives 可以使用，但整个 pattern 仍须是一个就地字符串字面量。
- 通用 matcher 基础设施可接收运行时 pattern 参数；这不是具体 pattern 声明。若其他位置确实不适合使用字面量，先告知开发者并说明原因，不要自行例外。
- 实际 spec、metadata 和测试 fixture 中的完整 URN 是数据而非 pattern，可以保留为变量或常量。

### 6. 测试与验证

- 测试 core 状态、日志，以及设备支持命令时的命令和输入校验。
- 测试 provider 成功匹配、缺失/重复/歧义时拒绝、状态更新、错误路径，以及设备支持命令时的命令请求；MIoT codec 还要覆盖 canonical round-trip、合法但未映射的 raw、型号分支和物理 domain 拒绝路径。
- 先运行受影响测试，再运行项目 build、lint 和格式检查。
