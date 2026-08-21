[![NPM version](https://img.shields.io/npm/v/@homelib/utils?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/@homelib/utils)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/utils

Reactive helpers and other utilities shared by HomeLib programs.

## `whenever`

`whenever` activates work while one or more MobX conditions are true. The
activation callback may return any disposer; it runs when a condition becomes
false or when the outer reaction is disposed.

```ts
const ready = whenever(() => sensor.ready && light.ready);

const dispose = ready.then(() =>
  sensor.onMotionDetected(() => {
    light.turnOn();
  }),
);
```

`.autorun()` and `.react()` use the same activation lifetime for a MobX
autorun or immediate reaction. All three methods return a disposer for the
whole condition chain.

## License

MIT License.
