<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./packages/web/src/library/public/homelib-text-dark.svg">
    <img alt="HomeLib" src="./packages/web/src/library/public/homelib-text-light.svg" width="200">
  </picture>
</h1>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-999999?style=flat-square"></a>
  <a href="https://discord.gg/wEVn2qcf8h"><img alt="Discord" src="https://img.shields.io/badge/chat-discord-5662f6?style=flat-square"></a>
</p>

HomeLib let you write home automations in full-featured JavaScript/TypeScript:

You can now utilize the power of JavaScript ecosystem and enjoy a functional version management with zero noise.

## Features

- Declare logical devices in code and HomeLib will help with the bindings.
- MobX-based reactive device state.

## Usage

Create a new script and run it directly with Node.js:

```ts
import {$home, bootstrap} from '@homelib/core';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('home');

const light = $home('home').$scope('living room').$light('light');

await bootstrap();

light.turnOn();
```

The terminal frontend handles setup and device binding during `bootstrap()`.
Use `--run` to run directly with existing bindings.

## Try it out

HomeLib is still under active development. The playground is the easiest way to
try it out with the current examples and project setup:

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/homelib/homelib.git
   cd homelib
   npm install
   ```

2. Write your automation in `packages/playground/src/program/home.ts`.
3. Build and start the playground, then follow the terminal UI to configure
   providers and bindings:

   ```sh
   npm run build
   node packages/playground/bld/program/home.js
   ```

4. After setup, run it directly with the saved bindings:

   ```sh
   node packages/playground/bld/program/home.js --run
   ```

## License

MIT License.
