[![NPM version](https://img.shields.io/npm/v/@homelib/xiaomi?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/@homelib/xiaomi)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/xiaomi

HomeLib 的 Xiaomi MIoT provider，提供米家账号授权、设备发现、绑定、状态同步与控制。

## 支持的设备

| 设备         | MIoT service                                 | 支持能力                                           |
| ------------ | -------------------------------------------- | -------------------------------------------------- |
| 灯           | `light`                                      | 开关；可选亮度、色温                               |
| 空调         | `air-conditioner`                            | 开关；可选运行模式、目标温度、目标湿度、室温、湿度 |
| 除湿机       | `dehumidifier`                               | 开关；可选运行模式、目标湿度、温度、湿度           |
| 风扇         | `fan`                                        | 开关；可选普通/自然风模式、四档风速、水平摇头      |
| 宠物喂食器   | `pet-feeder`                                 | 粮仓余粮状态、实时食盆余粮克数、按份放粮           |
| 温湿度传感器 | `temperature-humidity-sensor`, `environment` | 温度、相对湿度                                     |

除特别注明外，适配不限制设备型号或 MIoT spec revision。宠物喂食器目前匹配已验证且 spec 结构相同的 `xiaomi.feeder.pi2001` 与 `xiaomi.feeder.iv2001`；每项能力仅在设备公开的 service、属性类型、取值和访问方式均匹配时启用。

MIoT 标准属性的默认 access 并不保证每个设备实例一致，因此匹配始终以设备实际公开的 instance spec 为准。当前状态属性必须同时支持 `read` 和 `notify`；是否支持写入则在执行命令时检查 `write`。这是偏保守的行为：暂不通过轮询适配只有 `read` 的属性，后续可在引入轮询或更细的能力模型后重新评估。

## License

MIT License.
