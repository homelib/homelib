# Design Notes

- 为什么需要 `Device` 层处理 commands，而不是由 provider 自己的 `DeviceConnection` 实现处理？
  - 因为在 `Device` 要随时可控，但 `DeviceConnection` 不一定有挂上去。
