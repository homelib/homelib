[![NPM version](https://img.shields.io/npm/v/@homelib/xiaomi?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/@homelib/xiaomi)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/xiaomi

HomeLib 的 Xiaomi MIoT provider，提供米家账号授权、设备发现、绑定、状态同步与控制。

## 支持的设备

| 设备                 | MIoT service                                 | 支持能力                                                          |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| 灯                   | `light`                                      | 开关；可选亮度、色温                                              |
| 空调                 | `air-conditioner`                            | 开关；可选运行模式、自动/分档风速、目标温度、目标湿度、室温、湿度 |
| 除湿机               | `dehumidifier`                               | 开关；可选运行模式、目标湿度、温度、湿度、水箱保护状态            |
| 风扇                 | `fan`                                        | 开关；可选普通/自然风模式、四档风速、水平摇头                     |
| 宠物喂食器           | `pet-feeder`                                 | 粮仓余粮状态、实时食盆余粮克数、按份放粮                          |
| 温湿度传感器         | `temperature-humidity-sensor`, `environment` | 温度、相对湿度                                                    |
| 运动传感器           | `motion-sensor`                              | 人体移动状态                                                      |
| 运动环境光等级传感器 | `motion-sensor`                              | 人体移动状态、运动时读取的环境光明暗等级                          |

除特别注明外，适配不限制设备型号或 MIoT spec revision。空调风速目前匹配已验证的 `xiaomi-mt*` 与 `xiaomi-rr6r00`；除湿机水箱保护状态目前匹配已验证的 `xiaomi.derh.13l`；宠物喂食器目前匹配已验证且 spec 结构相同的 `xiaomi.feeder.pi2001` 与 `xiaomi.feeder.iv2001`；运动传感器按 service/event 结构匹配，目前已验证 `lumi.motion.bmgl01`；运动环境光等级传感器目前精确匹配 `lumi.motion.bmgl01`，每次移动事件后主动读取该型号的 `Weak`/`Strong` 状态并映射为 `low`/`high`。该等级是分类状态而非 lux 照度，仅在当前检测到移动且事件后的读取成功时可用；否则返回 `undefined`，不会沿用旧等级。每项能力仅在设备公开的 service、属性类型、取值和访问方式均匹配时启用。

同一类设备可能因型号或固件不同而公开不同能力；HomeLib 只启用设备实际支持且能够可靠同步的部分。

## License

MIT License.
