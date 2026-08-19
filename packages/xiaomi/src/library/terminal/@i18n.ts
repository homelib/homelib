import {type I18nCatalog, useI18n} from '@homelib/terminal';

type MiotTerminalMessages = {
  readonly common: {
    readonly error: (message: string) => string;
  };
  readonly bindings: {
    readonly loading: string;
    readonly backHint: string;
    readonly loadErrorHint: string;
    readonly confirmReplacement: (count: number) => string;
    readonly confirmHint: string;
    readonly saving: string;
    readonly chooseDevice: string;
    readonly noDevices: string;
    readonly unknownLocation: string;
    readonly range: (start: number, end: number, total: number) => string;
    readonly failedDevices: (count: number) => string;
    readonly incompleteDevices: (count: number) => string;
    readonly reloaded: string;
    readonly listHint: (hasDevices: boolean) => string;
    readonly mappingUnavailable: string;
    readonly bind: string;
    readonly done: string;
    readonly unavailable: string;
    readonly matchHint: (available: boolean) => string;
    readonly boundHere: string;
    readonly usedElsewhere: string;
    readonly offline: string;
  };
  readonly details: {
    readonly loading: string;
    readonly cancellingAuthorization: string;
    readonly loadErrorHint: string;
    readonly authorizationErrorHint: string;
    readonly loggingOut: string;
    readonly loggedOut: string;
    readonly logoutErrorHint: string;
    readonly setup: string;
    readonly authorizationRequired: string;
    readonly cloudRegion: string;
    readonly authorizationRequiredHint: string;
    readonly authorizing: string;
    readonly region: string;
    readonly startingCallback: string;
    readonly openUrl: string;
    readonly processingCallback: string;
    readonly completingAuthorization: string;
    readonly waitingForCallback: string;
    readonly pasteCallbackHelp: string;
    readonly callbackRejected: (message: string) => string;
    readonly pasteCallbackHint: string;
    readonly cancelHint: string;
    readonly emptyCallback: string;
    readonly logoutQuestion: string;
    readonly logoutDescription: string;
    readonly logoutHint: string;
    readonly ready: string;
    readonly filteringUnavailable: string;
    readonly accountMismatch: string;
    readonly homesSelected: (selected: number, total: number) => string;
    readonly noHomes: string;
    readonly saveFailed: (message: string) => string;
    readonly saved: string;
    readonly reloaded: string;
    readonly saving: string;
    readonly readyHint: (
      filteringAvailable: boolean,
      draftChanged: boolean,
      saveRequired: boolean,
    ) => string;
    readonly homeSource: {
      readonly owned: string;
      readonly sharedHome: string;
      readonly sharedDevice: string;
    };
  };
};

const EN_MESSAGES: MiotTerminalMessages = {
  common: {error: message => `error: ${message}`},
  bindings: {
    loading: 'finding matching mi home devices…',
    backHint: 'esc back',
    loadErrorHint: 'enter/r retry · esc back',
    confirmReplacement: count =>
      `replace ${count} existing ${count === 1 ? 'binding' : 'bindings'} and match this device?`,
    confirmHint: 'enter/y confirm · esc cancel',
    saving: 'saving device match…',
    chooseDevice: 'choose a device',
    noDevices: 'no matching devices found.',
    unknownLocation: 'unknown location',
    range: (start, end, total) => `${start}–${end} of ${total}`,
    failedDevices: count => `${count} devices could not be checked.`,
    incompleteDevices: count =>
      `${count} devices do not expose enough information.`,
    reloaded: 'devices reloaded.',
    listHint: hasDevices =>
      hasDevices
        ? '↑↓ select · enter match device · r reload · esc back'
        : 'r reload · esc back',
    mappingUnavailable:
      'this device mapping uses resources already bound elsewhere.',
    bind: '› bind device',
    done: '› done',
    unavailable: 'device match unavailable.',
    matchHint: available =>
      available
        ? 'enter confirm · esc choose another device'
        : 'esc choose another device',
    boundHere: 'bound here',
    usedElsewhere: 'used elsewhere',
    offline: 'offline',
  },
  details: {
    loading: 'loading miot configuration…',
    cancellingAuthorization: 'cancelling authorization…',
    loadErrorHint: 'enter/r retry · a authorize again · esc back',
    authorizationErrorHint: 'enter/r retry · esc choose region',
    loggingOut: 'logging out…',
    loggedOut: 'logged out locally. restart the script to continue.',
    logoutErrorHint: 'enter/r retry · esc cancel',
    setup: 'setup',
    authorizationRequired: '○ authorization required',
    cloudRegion: 'cloud region',
    authorizationRequiredHint: '↑↓ select · enter authorize · esc back',
    authorizing: '● authorizing',
    region: 'region',
    startingCallback: 'starting oauth callback…',
    openUrl: 'open this url in a browser:',
    processingCallback: 'processing pasted callback…',
    completingAuthorization: 'callback received; completing authorization…',
    waitingForCallback: 'waiting for browser callback…',
    pasteCallbackHelp:
      'if the browser cannot connect, paste the complete callback URL here.',
    callbackRejected: message => `callback rejected: ${message}`,
    pasteCallbackHint: 'paste callback URL · esc cancel',
    cancelHint: 'esc cancel',
    emptyCallback: 'callback URL is empty.',
    logoutQuestion: 'log out of this miot provider?',
    logoutDescription:
      'local oauth credentials will be removed. provider identity and the saved home filter will be kept.',
    logoutHint: 'y confirm · esc cancel',
    ready: '● ready',
    filteringUnavailable:
      'home filtering is unavailable because this account has no stable id.',
    accountMismatch:
      'saved homes belong to another account; all homes are selected.',
    homesSelected: (selected, total) => `homes ${selected} / ${total} selected`,
    noHomes: 'no homes discovered.',
    saveFailed: message => `save failed: ${message}`,
    saved: 'home selection saved.',
    reloaded: 'configuration reloaded.',
    saving: 'saving…',
    readyHint: (filteringAvailable, draftChanged, saveRequired) => {
      if (!filteringAvailable) {
        return '↑↓ select · r reload · o log out · esc back';
      } else if (draftChanged) {
        return '↑↓ select · space toggle · enter save · o log out · esc discard/back';
      } else if (saveRequired) {
        return '↑↓ select · space toggle · enter save · r reload · o log out · esc back';
      }

      return '↑↓ select · space toggle · r reload · o log out · esc back';
    },
    homeSource: {
      owned: 'owned',
      sharedHome: 'shared home',
      sharedDevice: 'shared device',
    },
  },
};

const ZH_CN_MESSAGES: MiotTerminalMessages = {
  common: {error: message => `错误：${message}`},
  bindings: {
    loading: '正在查找可匹配的米家设备…',
    backHint: 'esc 返回',
    loadErrorHint: 'enter/r 重试 · esc 返回',
    confirmReplacement: count => `替换现有的 ${count} 个绑定并匹配此设备？`,
    confirmHint: 'enter/y 确认 · esc 取消',
    saving: '正在保存设备匹配…',
    chooseDevice: '选择一个设备',
    noDevices: '未找到可匹配的设备。',
    unknownLocation: '未知位置',
    range: (start, end, total) => `第 ${start}–${end} 个，共 ${total} 个`,
    failedDevices: count => `${count} 个设备无法检查。`,
    incompleteDevices: count => `${count} 个设备提供的信息不足。`,
    reloaded: '设备已重新加载。',
    listHint: hasDevices =>
      hasDevices
        ? '↑↓ 选择 · enter 匹配设备 · r 重新加载 · esc 返回'
        : 'r 重新加载 · esc 返回',
    mappingUnavailable: '此设备所需的资源已绑定到其他设备。',
    bind: '› 绑定设备',
    done: '› 完成',
    unavailable: '无法匹配此设备。',
    matchHint: available =>
      available ? 'enter 确认 · esc 选择其他设备' : 'esc 选择其他设备',
    boundHere: '已绑定到这里',
    usedElsewhere: '已在其他位置使用',
    offline: '离线',
  },
  details: {
    loading: '正在加载 MIoT 配置…',
    cancellingAuthorization: '正在取消授权…',
    loadErrorHint: 'enter/r 重试 · a 重新授权 · esc 返回',
    authorizationErrorHint: 'enter/r 重试 · esc 选择区域',
    loggingOut: '正在退出登录…',
    loggedOut: '已在本地退出登录，请重新启动脚本以继续。',
    logoutErrorHint: 'enter/r 重试 · esc 取消',
    setup: '设置',
    authorizationRequired: '○ 需要授权',
    cloudRegion: '云区域',
    authorizationRequiredHint: '↑↓ 选择 · enter 授权 · esc 返回',
    authorizing: '● 正在授权',
    region: '区域',
    startingCallback: '正在启动 OAuth 回调…',
    openUrl: '请在浏览器中打开此网址：',
    processingCallback: '正在处理粘贴的回调…',
    completingAuthorization: '已收到回调，正在完成授权…',
    waitingForCallback: '正在等待浏览器回调…',
    pasteCallbackHelp: '如果浏览器无法连接，请在此粘贴完整的回调网址。',
    callbackRejected: message => `回调被拒绝：${message}`,
    pasteCallbackHint: '粘贴回调网址 · esc 取消',
    cancelHint: 'esc 取消',
    emptyCallback: '回调网址为空。',
    logoutQuestion: '退出此 MIoT 设备源？',
    logoutDescription:
      '本地 OAuth 凭据将被移除，设备源身份和已保存的家庭筛选仍会保留。',
    logoutHint: 'y 确认 · esc 取消',
    ready: '● 就绪',
    filteringUnavailable: '此账号没有稳定标识，无法筛选家庭。',
    accountMismatch: '已保存的家庭属于其他账号，当前已选择全部家庭。',
    homesSelected: (selected, total) => `家庭：已选择 ${selected} / ${total}`,
    noHomes: '未发现家庭。',
    saveFailed: message => `保存失败：${message}`,
    saved: '家庭选择已保存。',
    reloaded: '配置已重新加载。',
    saving: '正在保存…',
    readyHint: (filteringAvailable, draftChanged, saveRequired) => {
      if (!filteringAvailable) {
        return '↑↓ 选择 · r 重新加载 · o 退出登录 · esc 返回';
      } else if (draftChanged) {
        return '↑↓ 选择 · space 切换 · enter 保存 · o 退出登录 · esc 放弃并返回';
      } else if (saveRequired) {
        return '↑↓ 选择 · space 切换 · enter 保存 · r 重新加载 · o 退出登录 · esc 返回';
      }

      return '↑↓ 选择 · space 切换 · r 重新加载 · o 退出登录 · esc 返回';
    },
    homeSource: {
      owned: '自有',
      sharedHome: '共享家庭',
      sharedDevice: '共享设备',
    },
  },
};

const MIOT_TERMINAL_I18N = {
  defaultLocale: 'en',
  translations: {en: EN_MESSAGES, 'zh-CN': ZH_CN_MESSAGES},
} satisfies I18nCatalog<MiotTerminalMessages>;

export function useMiotTerminalI18n(): MiotTerminalMessages {
  return useI18n(MIOT_TERMINAL_I18N).messages;
}
