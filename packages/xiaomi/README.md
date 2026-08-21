[![NPM version](https://img.shields.io/npm/v/@homelib/xiaomi?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/@homelib/xiaomi)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/xiaomi

HomeLib 的 Xiaomi MIoT provider，提供米家账号授权、设备发现、绑定、状态同步与控制。

## 支持的设备

| 设备                 | MIoT service                                 | 支持能力                                                          |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| 灯                   | `light`                                      | 开关；可选亮度、色温                                              |
| 开关                 | `switch`                                     | 开关状态与控制                                                    |
| 浴霸                 | `ptc-bath-heater`, `light`                   | 照明、加热、吹风、换气、运行模式、目标温度与当前温度              |
| 空调                 | `air-conditioner`                            | 开关；可选运行模式、自动/分档风速、目标温度、目标湿度、室温、湿度 |
| 除湿机               | `dehumidifier`                               | 开关；可选运行模式、目标湿度、温度、湿度、水箱保护状态            |
| 门锁                 | `lock`, `door`, `battery`                    | 锁定状态、门开关状态、电量、锁操作与安全告警，只读                |
| 风扇                 | `fan`                                        | 开关；可选普通/自然风模式、四档风速、水平摇头                     |
| 宠物喂食器           | `pet-feeder`                                 | 粮仓余粮状态、实时食盆余粮克数、按份放粮                          |
| 智能音箱             | `intelligent-speaker`                        | 文本播报、静默或有声执行语音命令                                  |
| 温湿度传感器         | `temperature-humidity-sensor`, `environment` | 温度、相对湿度                                                    |
| 运动传感器           | `motion-sensor`                              | 人体移动状态                                                      |
| 运动环境光等级传感器 | `motion-sensor`                              | 人体移动状态、运动时读取的环境光明暗等级                          |

除特别注明外，适配不限制设备型号或 MIoT spec revision。开关目前精确匹配已验证的 `xiaomi.switch.w1`；浴霸目前精确匹配已验证的 `yeelink.bhf_light.v5`；空调风速目前匹配已验证的 `xiaomi-mt*` 与 `xiaomi-rr6r00`；除湿机水箱保护状态目前匹配已验证的 `xiaomi.derh.13l`；门锁目前精确匹配已验证的 `loock.lock.v5` 与 `xiaomi.lock.b03`，分别解析各自的门状态、锁状态、操作方式和安全告警。两者公开的云端 MIoT spec 均没有安全的远程上锁/开锁 action，因此当前只读；宠物喂食器目前匹配已验证且 spec 结构相同的 `xiaomi.feeder.pi2001` 与 `xiaomi.feeder.iv2001`；智能音箱目前精确匹配已验证的 `xiaomi.wifispeaker.lx04` 与 `xiaomi.wifispeaker.oh2p`；运动传感器按 service/event 结构匹配，目前已验证 `lumi.motion.bmgl01`；运动环境光等级传感器目前精确匹配 `lumi.motion.bmgl01`，移动事件到达后优先通过本地链路读取该型号的 `Weak`/`Strong` 状态并映射为 `low`/`high`，完成读取后才发布等待中的移动事件；密集到达的事件可能共享最近一次读取。该等级是分类状态而非 lux 照度，仅在当前检测到移动且事件后的读取成功时可用；否则返回 `undefined`，不会沿用旧等级。每项能力仅在设备公开的 service、属性类型、取值和访问方式均匹配时启用。

同一类设备可能因型号或固件不同而公开不同能力；HomeLib 只启用设备实际支持且能够可靠同步的部分。

状态快照默认优先使用本地链路，并在不可用时回退到云端。只有经过实机验证、来源存在稳定差异的属性才会单独优先云端；目前包括 `xiaomi.derh.13l` 的水箱保护状态，且仍保留本地回退。

## License

MIT License.
