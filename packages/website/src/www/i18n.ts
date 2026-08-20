export type WebsiteLocale = 'en' | 'zh-CN';

export type WebsiteFeature = {
  title: string;
  description: string;
};

export type WebsiteMessages = {
  docTitle: string;
  nav: {
    features: string;
    github: string;
  };
  hero: {
    title: string;
    subtitle: string;
    getStarted: string;
    viewOnGitHub: string;
  };
  features: WebsiteFeature[];
  example: {
    title: string;
    description: string;
  };
  footer: string;
};

export type WebsiteI18nCatalog = {
  defaultLocale: WebsiteLocale;
  translations: Record<WebsiteLocale, WebsiteMessages>;
};

const CATALOG = {
  defaultLocale: 'en' as const,
  translations: {
    en: {
      docTitle: 'HomeLib — Code-first Home Automation',
      nav: {
        features: 'Features',
        github: 'GitHub',
      },
      hero: {
        title: 'Home automation, defined in code.',
        subtitle:
          'HomeLib is a TypeScript-first framework for building dependable ' +
          'home automation. Declare your home as a type-safe tree, bind real ' +
          'providers, and let reactive state drive your automations.',
        getStarted: 'Get Started',
        viewOnGitHub: 'View on GitHub',
      },
      features: [
        {
          title: 'Code-first home tree',
          description:
            'Declare your home, scopes and devices as a fully type-safe tree ' +
            'in TypeScript.',
        },
        {
          title: 'Reactive by design',
          description:
            'MobX-powered device states, computed values and reactions make ' +
            'automations feel natural.',
        },
        {
          title: 'Provider ecosystem',
          description:
            'Start with MIoT and extend to more protocols through a clean ' +
            'provider interface.',
        },
      ],
      example: {
        title: 'Example',
        description:
          'A minimal HomeLib automation that turns on a light when motion is ' +
          'detected.',
      },
      footer: 'MIT Licensed · Built by vilicvane',
    },
    'zh-CN': {
      docTitle: 'HomeLib — 代码优先的家庭自动化',
      nav: {
        features: '特性',
        github: 'GitHub',
      },
      hero: {
        title: '用代码定义家庭自动化。',
        subtitle:
          'HomeLib 是一个 TypeScript 优先的框架，用于构建可靠的家庭自动化。' +
          '以类型安全的树声明你的家，绑定真实设备，让响应式状态驱动你的自动化。',
        getStarted: '开始使用',
        viewOnGitHub: '在 GitHub 查看',
      },
      features: [
        {
          title: '代码优先的家居树',
          description:
            '在 TypeScript 中以完全类型安全的树声明你的家、作用域与设备。',
        },
        {
          title: '天生响应式',
          description:
            '基于 MobX 的设备状态、派生值与反应式逻辑，让自动化自然流畅。',
        },
        {
          title: '设备生态',
          description: '从 MIoT 起步，通过简洁的 provider 接口扩展更多协议。',
        },
      ],
      example: {
        title: '示例',
        description: '一个最小的 HomeLib 自动化：检测到运动时开灯。',
      },
      footer: 'MIT 许可 · 由 vilicvane 构建',
    },
  },
} satisfies WebsiteI18nCatalog;

export const DEFAULT_LOCALE = CATALOG.defaultLocale;

export const WEBSITE_MESSAGES = CATALOG.translations;

export function resolveWebsiteLocale(requested: string | null): WebsiteLocale {
  if (requested) {
    const language = requested.split('-')[0].toLowerCase();

    if (language === 'zh') {
      return 'zh-CN';
    }

    if (language === 'en') {
      return 'en';
    }
  }

  return DEFAULT_LOCALE;
}
