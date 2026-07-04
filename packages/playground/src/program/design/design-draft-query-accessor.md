# homelib API 设计草稿 — query/accessor 方向

## 核心理念

- 设备对象是 Proxy，即时创建，背后连接 lazy
- 属性是 MobX observable，用 $ 后缀标记
- 方法是状态变更触发器，不是协议命令；同步、确定性、不失败
- 协议层异步同步，离线 queue，恢复后自动 sync，失败回滚 + error 事件
- 首次运行 TUI 引导配置/绑定
- 不约束用户怎么写自动化，交给 JS 生态实践

## 查询方式演进

1. `$()` / `$$()` 区分单个/集合 → jQuery 理念合并为 `$()` 永远返回集合
2. 三种查询：单个 `$()`、一组 `$$()`、多个 `$[]()` → `$[]()` 语法不实际
3. 合并为两种：`$()` 单个、`$$()` 集合（广播/遍历两种用法）
4. 类型问题：query by string 无法提供静态类型 → accessor 方案
   - `xiaomi.light.$('客厅灯')` → LightDevice
   - accessor (light) 决定类型，query ('客厅灯') 只过滤
   - 家庭 scope: `xiaomi.home('美岸').light.$('客厅灯')`

## 待解决的问题

- accessor 粒度：按大类 (light) vs 按 MIoT spec (dimmable-light, color-light)
- provider 开发者如何添加 scope 支持 — homelib 需要为 provider 开发提供结构和工具
- 用户想探索不用 query 的 `new Device()` 方向
