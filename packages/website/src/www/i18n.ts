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
    switchLanguage: string;
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
      docTitle: 'HomeLib — Code-first, TypeScript-native Home Automation',
      nav: {
        features: 'Features',
        github: 'GitHub',
        switchLanguage: 'Switch to Simplified Chinese',
      },
      hero: {
        title: 'Home automation, defined in code.',
        subtitle:
          'HomeLib is a code-first home automation framework—TypeScript-native ' +
          'and agent-ready. Declare your home as a fully typed tree, bind real ' +
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
          title: 'Agent-ready',
          description:
            'Typed models, provider adapters, tests and a built-in development ' +
            'skill let coding agents extend device support from verified ' +
            'metadata—not guesses.',
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
      docTitle: 'HomeLib — 代码优先、TypeScript 原生的家庭自动化',
      nav: {
        features: '特性',
        github: 'GitHub',
        switchLanguage: '切换到英文',
      },
      hero: {
        title: '用代码定义家庭自动化。',
        subtitle:
          'HomeLib 是一个代码优先、原生面向 TypeScript 且 Agent-ready 的家庭' +
          '自动化框架。以完全类型安全的树声明你的家，绑定真实设备，让响应式状态' +
          '驱动自动化。',
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
          title: 'Agent-ready',
          description:
            '类型化模型、provider 适配、测试与内置开发 Skill，让编程 Agent 能' +
            '依据真实 metadata 扩展设备支持，而不是猜测协议语义。',
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
