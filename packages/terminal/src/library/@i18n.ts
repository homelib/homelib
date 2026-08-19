import type {I18nCatalog} from './i18n.js';
import {useI18n} from './i18n.js';

export type TerminalMessages = {
  readonly common: {
    readonly providers: string;
    readonly bindings: string;
    readonly noProviders: string;
    readonly configurationUnavailable: string;
    readonly bindingUnavailable: string;
    readonly error: (message: string) => string;
  };
  readonly startup: {
    readonly run: string;
    readonly providerCount: (count: number) => string;
    readonly bindingSummary: (bound: number, needsBinding: number) => string;
    readonly hint: string;
  };
  readonly providers: {
    readonly hint: string;
    readonly detailHint: string;
  };
  readonly bindings: {
    readonly staleCount: (count: number) => string;
    readonly noRootScopes: string;
    readonly listHint: (hasScopes: boolean, hasStale: boolean) => string;
    readonly staleTitle: string;
    readonly confirmRemoveStale: (count: number, path: string) => string;
    readonly removingStale: string;
    readonly staleRemoved: string;
    readonly noStale: string;
    readonly staleListHint: (hasBindings: boolean) => string;
    readonly noLogicalDevices: string;
    readonly scopeHint: (hasItems: boolean) => string;
    readonly scopeSummary: (
      deviceCount: number,
      needsBinding: number,
    ) => string;
    readonly deviceStatus: (bound: number, total: number) => string;
    readonly providerBound: string;
    readonly bindingRemoved: string;
    readonly bindingListTitle: string;
    readonly deviceBinding: string;
    readonly confirmRemoveBinding: (name: string | undefined) => string;
    readonly removingBinding: string;
    readonly deviceHint: (
      hasProviders: boolean,
      hasBindings: boolean,
    ) => string;
    readonly matchWith: (provider: string) => string;
    readonly providerHint: string;
    readonly defaultDevice: string;
  };
  readonly hints: {
    readonly confirm: string;
    readonly busy: string;
    readonly retry: string;
    readonly unavailable: string;
  };
};

const EN_MESSAGES: TerminalMessages = {
  common: {
    providers: 'providers',
    bindings: 'bindings',
    noProviders: 'no providers declared.',
    configurationUnavailable: 'configuration unavailable.',
    bindingUnavailable: 'binding unavailable.',
    error: message => `error: ${message}`,
  },
  startup: {
    run: 'run',
    providerCount: count => `${count} declared`,
    bindingSummary: (bound, needsBinding) =>
      `${bound} bound · ${needsBinding} need binding`,
    hint: '↑↓ select · enter · ctrl+c exit',
  },
  providers: {
    hint: '↑↓ select · enter · esc back · q menu · ctrl+c exit',
    detailHint: 'q menu · ctrl+c exit',
  },
  bindings: {
    staleCount: count => `${count} stale bindings`,
    noRootScopes: 'no root scopes declared.',
    listHint: (hasScopes, hasStale) =>
      joinHints(
        hasScopes ? ['↑↓ select', 'enter'] : [],
        hasStale ? ['u stale'] : [],
        ['esc back', 'q menu', 'ctrl+c exit'],
      ),
    staleTitle: 'stale',
    confirmRemoveStale: (count, path) =>
      count === 1
        ? `remove the stale binding for ${path}?`
        : `remove all ${count} stale bindings for ${path}?`,
    removingStale: 'removing stale binding…',
    staleRemoved: 'stale binding removed.',
    noStale: 'no stale bindings.',
    staleListHint: hasBindings =>
      hasBindings
        ? '↑↓ select · enter · esc back · q menu · ctrl+c exit'
        : 'esc back · q menu · ctrl+c exit',
    noLogicalDevices: 'no logical devices declared.',
    scopeHint: hasItems =>
      hasItems
        ? '↑↓ select · enter · esc back · q menu · ctrl+c exit'
        : 'esc back · q menu · ctrl+c exit',
    scopeSummary: (deviceCount, needsBinding) =>
      `${deviceCount} devices · ${needsBinding} need binding`,
    deviceStatus: (bound, total) =>
      bound === total ? 'bound' : bound === 0 ? 'unbound' : 'partially bound',
    providerBound: 'bound',
    bindingRemoved: 'binding removed.',
    bindingListTitle: 'bindings',
    deviceBinding: 'device binding',
    confirmRemoveBinding: name =>
      name === undefined
        ? 'remove this device binding?'
        : `remove the binding for ${name}?`,
    removingBinding: 'removing binding…',
    deviceHint: (hasProviders, hasBindings) =>
      joinHints(
        hasProviders ? ['↑↓ select', 'enter'] : [],
        hasBindings ? ['u unbind'] : [],
        ['esc back', 'q menu', 'ctrl+c exit'],
      ),
    matchWith: provider => `match with ${provider}`,
    providerHint: 'q menu · ctrl+c exit',
    defaultDevice: '(default device)',
  },
  hints: {
    confirm: 'enter/y confirm · esc cancel · q menu · ctrl+c exit',
    busy: 'q menu · ctrl+c exit',
    retry: 'enter/r retry · esc back · q menu · ctrl+c exit',
    unavailable: 'esc back',
  },
};

const ZH_CN_MESSAGES: TerminalMessages = {
  common: {
    providers: '设备源',
    bindings: '设备绑定',
    noProviders: '未声明设备源。',
    configurationUnavailable: '此设备源无法配置。',
    bindingUnavailable: '此设备源无法进行绑定。',
    error: message => `错误：${message}`,
  },
  startup: {
    run: '运行',
    providerCount: count => `${count} 个已声明`,
    bindingSummary: (bound, needsBinding) =>
      `${bound} 个已完成 · ${needsBinding} 个待绑定`,
    hint: '↑↓ 选择 · enter 确认 · ctrl+c 退出',
  },
  providers: {
    hint: '↑↓ 选择 · enter 确认 · esc 返回 · q 主菜单 · ctrl+c 退出',
    detailHint: 'q 主菜单 · ctrl+c 退出',
  },
  bindings: {
    staleCount: count => `${count} 个失效绑定`,
    noRootScopes: '未声明根空间。',
    listHint: (hasScopes, hasStale) =>
      joinHints(
        hasScopes ? ['↑↓ 选择', 'enter 确认'] : [],
        hasStale ? ['u 查看失效绑定'] : [],
        ['esc 返回', 'q 主菜单', 'ctrl+c 退出'],
      ),
    staleTitle: '失效绑定',
    confirmRemoveStale: (count, path) =>
      count === 1
        ? `移除 ${path} 的失效绑定？`
        : `移除 ${path} 的全部 ${count} 个失效绑定？`,
    removingStale: '正在移除失效绑定…',
    staleRemoved: '失效绑定已移除。',
    noStale: '没有失效绑定。',
    staleListHint: hasBindings =>
      hasBindings
        ? '↑↓ 选择 · enter 确认 · esc 返回 · q 主菜单 · ctrl+c 退出'
        : 'esc 返回 · q 主菜单 · ctrl+c 退出',
    noLogicalDevices: '未声明逻辑设备。',
    scopeHint: hasItems =>
      hasItems
        ? '↑↓ 选择 · enter 确认 · esc 返回 · q 主菜单 · ctrl+c 退出'
        : 'esc 返回 · q 主菜单 · ctrl+c 退出',
    scopeSummary: (deviceCount, needsBinding) =>
      `${deviceCount} 个设备 · ${needsBinding} 个待绑定`,
    deviceStatus: (bound, total) =>
      bound === total ? '已绑定' : bound === 0 ? '未绑定' : '部分已绑定',
    providerBound: '已绑定',
    bindingRemoved: '绑定已移除。',
    bindingListTitle: '已有绑定',
    deviceBinding: '设备绑定',
    confirmRemoveBinding: name =>
      name === undefined ? '移除此设备绑定？' : `移除 ${name} 的绑定？`,
    removingBinding: '正在移除绑定…',
    deviceHint: (hasProviders, hasBindings) =>
      joinHints(
        hasProviders ? ['↑↓ 选择', 'enter 确认'] : [],
        hasBindings ? ['u 解除绑定'] : [],
        ['esc 返回', 'q 主菜单', 'ctrl+c 退出'],
      ),
    matchWith: provider => `通过 ${provider} 匹配`,
    providerHint: 'q 主菜单 · ctrl+c 退出',
    defaultDevice: '（默认设备）',
  },
  hints: {
    confirm: 'enter/y 确认 · esc 取消 · q 主菜单 · ctrl+c 退出',
    busy: 'q 主菜单 · ctrl+c 退出',
    retry: 'enter/r 重试 · esc 返回 · q 主菜单 · ctrl+c 退出',
    unavailable: 'esc 返回',
  },
};

export const TERMINAL_I18N = {
  defaultLocale: 'en',
  translations: {en: EN_MESSAGES, 'zh-CN': ZH_CN_MESSAGES},
} satisfies I18nCatalog<TerminalMessages>;

export function useTerminalI18n(): TerminalMessages {
  return useI18n(TERMINAL_I18N).messages;
}

function joinHints(...groups: readonly string[][]): string {
  return groups.flat().join(' · ');
}
