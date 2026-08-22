<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/web/src/library/public/homelib-text-dark.svg">
  <img align="right" alt="HomeLib" src="./packages/web/src/library/public/homelib-text-light.svg" width="240">
</picture>

English | [简体中文](./README.zh-CN.md)

[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](./LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

## Introduction

HomeLib lets you write home automations in full-featured JavaScript/TypeScript:

You can now utilize the power of JavaScript ecosystem and enjoy a functional version management with zero noise.

## Features

- Declare logical devices in code and HomeLib will help with the bindings.
- MobX-based reactive device state and typed device events.

## Usage

Create a new script and run it directly with Node.js:

```ts
import {$home, bootstrap} from '@homelib/core';
import {whenever} from '@homelib/utils';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('home');

const home = $home('home', home =>
  home.$temperatureHumiditySensor('sensor').$dehumidifier('dehumidifier'),
);

await bootstrap();

whenever(() => home.sensor.ready && home.dehumidifier.ready).autorun(() => {
  if (home.sensor.relativeHumidity === undefined) {
    return;
  }

  if (home.sensor.relativeHumidity >= 0.6) {
    home.dehumidifier.turnOn();
  } else if (home.sensor.relativeHumidity <= 0.5) {
    home.dehumidifier.turnOff();
  }
});
```

The declaration remains fully type-safe: `home` exposes only the devices
declared on it, and each device exposes only its supported state and commands.

`whenever()` activates the rule only while both devices are ready. MobX then
reruns the `autorun()` whenever the observable humidity changes. The two
different thresholds prevent rapid toggling around a single value. For
individual occurrences, devices also expose typed events such as
`onMotionDetected()`.

The terminal frontend handles setup and device binding during `bootstrap()`.
Use `--run` to run directly with existing bindings.

## Try it out

HomeLib is still under active development. Start with the
[playground home source](./packages/playground/src/program/home.ts) to get a
feel for a complete, real-world setup. The easiest way to explore it yourself is
to use an AI coding agent together with the playground and the project skills
included in this repository. These skills cover device development and device
information adjustments, including guidance for safely authorizing access to
real devices when needed.

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/homelib/homelib.git
   cd homelib
   npm install
   ```

2. Open the checkout with your AI coding agent. For device development or
   device information adjustments, ask it to follow the built-in
   [device development skill](./.github/skills/device-development/SKILL.md).
3. Write your automation in `packages/playground/src/program/home.ts`.
4. Build and start the playground, then follow the terminal UI to configure
   providers and bindings:

   ```sh
   npm run build
   node packages/playground/bld/program/home.js
   ```

5. After setup, run it directly with the saved bindings:

   ```sh
   node packages/playground/bld/program/home.js --run
   ```

6. To try the current working tree on another machine, run the deployment tool.
   It builds the project, synchronizes the working tree over SSH, and runs
   `npm install` remotely. The remote directory defaults to `~/homelib`:

   ```sh
   npm run deploy -- home-server
   ```

   The script requires Bash, rsync, and npm on the remote host. It mirrors the
   local working tree with `rsync --delete-delay`, so files that no longer exist
   locally are removed remotely after a successful transfer. Remote `.git` and
   `node_modules` directories are preserved. Set `DEPLOY_SSH` to use a specific
   SSH executable.

## License

MIT License.
