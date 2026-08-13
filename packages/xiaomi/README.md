[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)

# @homelib/xiaomi

Homelib 的 Xiaomi MIoT provider，提供米家账号授权、设备发现、绑定、状态同步与控制。

## 支持的设备

| 设备   | 已知 profile      | 支持能力                                           |
| ------ | ----------------- | -------------------------------------------------- |
| 灯     | 通用 MIoT `light` | 开关；可选亮度、色温                               |
| 空调   | `xiaomi-rr6r00:3` | 开关；可选运行模式、目标温度、目标湿度；室温、湿度 |
| 除湿机 | `xiaomi-13l:1`    | 开关；可选运行模式、目标湿度；温度、湿度           |
| 风扇   | `dmaker-p5c:1`    | 开关；可选风感、四档风速、水平摇头                 |

可选能力仅在设备公开的 MIoT 属性与当前 profile 匹配时启用。其他符合相应 MIoT service 的空调、除湿机和风扇目前仅提供开关兼容；灯使用通用 service profile。

## License

MIT License.
