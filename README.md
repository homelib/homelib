[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](./LICENSE)

# Homelib

A TypeScript framework for declaring your home, binding real devices, and
writing automations.

## Usage

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

## License

MIT License.
