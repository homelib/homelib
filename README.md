[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](./LICENSE)

# HomeLib

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
Use `--automation` to run directly with existing bindings.

## Try it out

HomeLib is currently under development. To try it out:

1. Clone the repository.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Write your automation in `packages/playground/src/program/home.ts`
4. Bootstrap the automation:

   ```sh
   npx tsx packages/playground/src/program/home.ts
   ```

Ask some AI agent to implement more devices so it will be actually useful.

## License

MIT License.
