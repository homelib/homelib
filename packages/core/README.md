[![NPM version](https://img.shields.io/npm/v/@homelib/core?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/@homelib/core)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/core

HomeLib's logical device model, command queue, reactive state runtime, provider
contracts, and bootstrap API.

## Device model

Automations work with logical `Device` instances. A device owns one or more
`Endpoint`s, while providers attach `EndpointConnection`s that supply state and
execute prepared commands. This keeps automation code available even while a
provider is disconnected or a binding has not been configured yet.

The built-in device namespace includes lights, fans, air conditioners,
dehumidifiers, temperature/humidity sensors, motion sensors, and pet feeders.

## License

MIT License.
