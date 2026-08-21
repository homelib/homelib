[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/playground

Working-tree examples for trying HomeLib against real providers and devices.

The current program demonstrates:

- logical device and provider declarations in `home.ts`;
- reactive temperature/humidity control using device-scoped sensor
  capabilities;
- automatic pet feeding;
- read-only door-lock state and event binding;
- bathroom ventilation based on how long the light was on;
- event-driven corridor lighting using the ambient light level observed for
  each motion detection;
- recurring smart-speaker reminders while the dehumidifier water tank is full.

See
[`@motion-activated-lighting.ts`](./src/program/@motion-activated-lighting.ts)
for a device-event subscription whose lifetime follows device readiness.

Build and run the playground from the repository root:

```sh
npm run build
node packages/playground/bld/program/home.js
```

After providers and bindings are configured, pass `--run` to reuse them
without opening the setup flow.

## License

MIT License.
