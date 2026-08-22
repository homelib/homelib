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
- 基于 MobX 的响应式设备状态与类型化设备事件。

## 使用方法

创建一个新脚本，然后直接使用 Node.js 运行：

```ts
import {$home, bootstrap} from '@homelib/core';
import {whenever} from '@homelib/utils';
import {$xiaomi} from '@homelib/xiaomi';

$xiaomi('家');

const 家 = $home('家', home =>
  home.$temperatureHumiditySensor('传感器').$dehumidifier('除湿机'),
);

await bootstrap();

whenever(() => 家.传感器.ready && 家.除湿机.ready).autorun(() => {
  if (家.传感器.relativeHumidity === undefined) {
    return;
  }

  if (家.传感器.relativeHumidity >= 0.6) {
    家.除湿机.turnOn();
  } else if (家.传感器.relativeHumidity <= 0.5) {
    家.除湿机.turnOff();
  }
});
```

这份声明仍然完全类型安全：`家` 只会暴露其中声明的设备，每个设备也只会暴露自身支持的
状态与命令。

`whenever()` 只在两个设备就绪期间激活这条规则；期间每当可观察的湿度变化，MobX 都会
重新运行 `autorun()`。两个不同的阈值可以避免设备在单一临界值附近频繁启停。对于运动检测
这类独立事件，设备还会提供 `onMotionDetected()` 这样的类型化订阅接口。

终端前端会在 `bootstrap()` 期间处理设置和设备绑定。
已有绑定时，可以使用 `--run` 直接运行。

## 试用

HomeLib 仍在积极开发中。可以先查看
[playground home 源码](./packages/playground/src/program/home.ts)，直观感受一套完整的实际配置。
最方便的试用方式，是让 AI 编程 agent 结合 playground 和项目内置技能协助你开发设备或调整
设备信息。需要真实设备时，技能也会指导你安全地完成授权与调试。

1. 克隆仓库并安装依赖：

   ```sh
   git clone https://github.com/homelib/homelib.git
   cd homelib
   npm install
   ```

2. 使用 AI 编程 agent 打开该工作区。需要开发设备或调整设备信息时，让它遵循项目内置的
   [设备开发技能](./.github/skills/device-development/SKILL.md)。
3. 在 `packages/playground/src/program/home.ts` 中编写自动化。
4. 构建并启动 playground，然后按照终端界面的指引配置 provider 和设备绑定：

   ```sh
   npm run build
   node packages/playground/bld/program/home.js
   ```

5. 完成设置后，使用已有绑定直接运行：

   ```sh
   node packages/playground/bld/program/home.js --run
   ```

6. 如需在另一台机器上试用当前工作区，可以运行部署工具。
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
