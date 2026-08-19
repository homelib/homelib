<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/web/src/library/public/homelib-text-dark.svg">
  <img align="right" alt="HomeLib" src="./packages/web/src/library/public/homelib-text-light.svg" width="240">
</picture>

[English](./README.md) | 简体中文

[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](./LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

## 简介

HomeLib 让你使用功能完整的 JavaScript/TypeScript 编写家庭自动化：

你可以充分利用 JavaScript 生态系统，并享受真正可用且零噪音的版本管理。

## 功能

- 在代码中声明逻辑设备，由 HomeLib 协助完成绑定。
- 基于 MobX 的响应式设备状态。

## 使用方法

创建一个新脚本，然后直接使用 Node.js 运行：

```ts
import {$home, bootstrap} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('home');

const home = $home('home', home =>
  home.$scope('livingRoom', room =>
    room.$light('light').$motionSensor('motionSensor'),
  ),
);

await bootstrap();

autorun(() => {
  if (home.livingRoom.motionSensor.motionDetected) {
    home.livingRoom.light.turnOn();
  }
});
```

声明回调会创建一棵完全类型安全的树：每一层只能通过属性访问该层已经声明的空间和设备。
更完整的例子请参考 [playground home](./packages/playground/src/program/home.ts)。

终端前端会在 `bootstrap()` 期间处理设置和设备绑定。
已有绑定时，可以使用 `--run` 直接运行。
它会尽可能跟随系统语言，也可以通过 `--locale=zh-CN` 或
`HOMELIB_LOCALE` 环境变量覆盖语言设置。

## 试用

HomeLib 仍在积极开发中。通过 playground 可以最方便地体验当前示例和项目配置：

1. 克隆仓库并安装依赖：

   ```sh
   git clone https://github.com/homelib/homelib.git
   cd homelib
   npm install
   ```

2. 在 `packages/playground/src/program/home.ts` 中编写自动化。
3. 构建并启动 playground，然后按照终端界面的指引配置 provider 和设备绑定：

   ```sh
   npm run build
   node packages/playground/bld/program/home.js
   ```

4. 完成设置后，使用已有绑定直接运行：

   ```sh
   node packages/playground/bld/program/home.js --run
   ```

5. 如需在另一台机器上试用当前工作区，可以运行部署工具。
   它会构建项目，通过 SSH 同步工作区，并在远程运行 `npm install`。
   远程目录默认为 `~/homelib`：

   ```sh
   npm run deploy -- home-server
   ```

   该脚本要求远程主机具备 Bash、rsync 和 npm。它使用 `rsync --delete-delay`
   镜像本地工作区，因此本地已删除的文件会在同步成功后从远程删除。
   远程的 `.git` 和 `node_modules` 目录会被保留。
   如需指定 SSH 可执行文件，请设置 `DEPLOY_SSH`。

## 许可证

MIT License。
