[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)

# @homelib/xiaomi

Homelib 的 Xiaomi MIoT provider，提供米家账号授权、设备发现、绑定、状态同步与控制。

## 支持的设备

| 设备   | MIoT service      | 支持能力                                           |
| ------ | ----------------- | -------------------------------------------------- |
| 灯     | `light`           | 开关；可选亮度、色温                               |
| 空调   | `air-conditioner` | 开关；可选运行模式、目标温度、目标湿度、室温、湿度 |
| 除湿机 | `dehumidifier`    | 开关；可选运行模式、目标湿度、温度、湿度           |
| 风扇   | `fan`             | 开关；可选普通/自然风模式、四档风速、水平摇头      |

适配不限制设备型号或 MIoT spec revision。每项能力仅在设备公开的 service、属性类型、取值和访问方式均匹配时启用。

## License

MIT License.
