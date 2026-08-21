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
dehumidifiers, door locks, temperature/humidity sensors, motion sensors, and
pet feeders.

## State and events

Device state is observable through MobX and represents the latest known value.
A `DeviceEvent` represents one individual occurrence instead. Devices expose
events through a callable `DeviceEventSource` that returns an idempotent
disposer:

```ts
const dispose = motionSensor.onMotionDetected(() => {
  light.turnOn();
});
```

The subscription remains attached to the logical endpoint when its provider
connection is replaced. A device capability may expose both forms when they
carry different meaning; for example, `MotionDetectionSource` provides the
current `motionDetected` state and the `onMotionDetected` event.

`DoorLock` similarly keeps lock state and physical door state independent. It
also exposes typed operation and alert events, because two identical unlocks
are separate occurrences even when the resulting state is unchanged.

## Conventions

- Percentage-like values use a normalized scale from `0` to `1`.
- Device implementations clamp numeric commands to their supported ranges.
  A lower bound describes the minimum of that value rather than another state.
  For example, brightness `0` means minimum brightness, while turning a light
  off is a separate operation.

## License

MIT License.
