[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# @homelib/playground

Working-tree examples for trying HomeLib against real providers and devices.

The current program demonstrates:

- logical device and provider declarations in `home.ts`;
- reactive temperature/humidity control using device-scoped sensor
  capabilities;
- automatic pet feeding; and
- observing motion and categorical ambient light level with MobX `autorun`.

Build and run the playground from the repository root:

```sh
npm run build
node packages/playground/bld/program/home.js
```

After providers and bindings are configured, pass `--run` to reuse them
without opening the setup flow.

## License

MIT License.
