# Design Notes

- 为什么需要 `Endpoint` 层处理 commands，而不是由 provider 自己的 `EndpointConnection` 实现处理？
  - 因为 `Endpoint` 要随时可控，但 `EndpointConnection` 不一定有挂上去。
