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
          title: 'Type-safe home',
          description:
            'Model your home and devices in TypeScript, with types that ' +
            'mirror the exact structure you declare.',
        },
        {
          title: 'Reactive rules',
          description:
            'Drive ongoing rules with MobX state, and capture individual ' +
            'occurrences with typed events.',
        },
        {
          title: 'Agent-ready',
          description:
            'Let agents extend device support reliably with verified metadata, ' +
            'tests and a built-in skill.',
        },
      ],
      example: {
        title: 'Example',
        description:
          'While both devices are ready, MobX reruns this rule as observable ' +
          'humidity changes; separate 50% and 60% thresholds prevent rapid toggling.',
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
          title: '类型安全的家',
          description:
            '用 TypeScript 声明家与设备，让类型精确映射你定义的实际结构。',
        },
        {
          title: '响应式规则',
          description:
            '用 MobX 状态持续驱动规则，以类型化事件捕捉运动检测等独立事件。',
        },
        {
          title: 'Agent-ready',
          description:
            '让 Agent 借助真实 metadata、测试与内置 Skill，可靠扩展设备支持。',
        },
      ],
      example: {
        title: '示例',
        description:
          '两个设备就绪期间，每当可观察的湿度变化，MobX 都会重新运行这条规则；50% 与 60% 两个阈值可以避免频繁启停。',
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
