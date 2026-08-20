import * as Lucide from 'lucide-react';
import type {ReactElement} from 'react';
import React, {useEffect, useState} from 'react';
import styled, {createGlobalStyle} from 'styled-components';
import codeHtml from 'virtual:home-code';

import {
  WEBSITE_MESSAGES,
  type WebsiteLocale,
  resolveWebsiteLocale,
} from './i18n.js';

const GlobalStyle = createGlobalStyle`
  :root {
    --color-accent: #ffc42d;
    --color-on-accent: #fff;

    --color-text-primary: #333;
    --color-text-secondary: #666;

    --color-layout-border: #ddd;

    --font-weight-bold: 600;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;

    transition: color 0.2s, background-color 0.2s, border-color 0.2s;
  }

  html,
  body,
  #app {
    min-height: 100%;
  }

  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    color: var(--color-text-primary);
    background: #fff8e8;
  }

  a {
    color: inherit;
    text-decoration: none;
  }
`;

const Page = styled.div`
  min-height: 100%;

  display: flex;
  flex-direction: column;

  background: radial-gradient(ellipse at left top, #ffffff 0%, #fff8e8 100%);
`;

const NavBar = styled.header`
  display: flex;
  height: 64px;
  padding: 0 32px;

  align-items: center;
  justify-content: space-between;

  border-bottom: 1px solid var(--color-layout-border);
`;

const NavLinks = styled.nav`
  display: flex;
  align-items: center;
  gap: 24px;
`;

const NavLink = styled.a`
  color: var(--color-text-secondary);
  font-weight: 500;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const LanguageToggle = styled.button`
  padding: 0;

  font: inherit;
  font-weight: 500;

  color: var(--color-text-secondary);

  background: none;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const Main = styled.main`
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 64px 32px;
`;

const Hero = styled.section`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  margin-bottom: 64px;
`;

const HeroTitle = styled.h1`
  font-size: 48px;
  line-height: 1.1;
  color: var(--color-text-primary);
`;

const HeroSubtitle = styled.p`
  max-width: 560px;
  font-size: 18px;
  line-height: 1.6;
  color: var(--color-text-secondary);
`;

const Buttons = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 8px;
`;

const PrimaryButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;

  border-radius: 4px;

  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: var(--font-weight-bold);

  box-shadow: 0 2px 8px rgba(255, 196, 45, 0.35);

  &:hover {
    filter: brightness(0.97);
  }
`;

const SecondaryButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;

  border-radius: 4px;
  border: 1px solid var(--color-layout-border);

  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.7);

  &:hover {
    border-color: var(--color-accent);
  }
`;

const Features = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
`;

const FeatureCard = styled.div`
  padding: 24px;

  border: 1px solid var(--color-layout-border);
  border-radius: 4px;

  background: rgba(255, 255, 255, 0.75);

  > svg {
    width: 28px;
    height: 28px;
    margin-bottom: 12px;

    color: var(--color-accent);
  }
`;

const FeatureTitle = styled.h2`
  margin-bottom: 8px;

  font-size: 18px;
`;

const FeatureDescription = styled.p`
  line-height: 1.6;
  color: var(--color-text-secondary);
`;

const CodeSection = styled.section`
  margin-top: 64px;
`;

const CodeTitle = styled.h2`
  margin-bottom: 16px;

  font-size: 24px;
`;

const CodeDescription = styled.p`
  margin-bottom: 16px;

  line-height: 1.6;
  color: var(--color-text-secondary);
`;

const CodeBlock = styled.div`
  overflow-x: auto;

  border: 1px solid var(--color-layout-border);
  border-radius: 4px;

  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

  .shiki {
    margin: 0;
    padding: 24px;
    font-size: 13px;
    line-height: 1.7;
    font-family:
      'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace;
  }

  code {
    font-family: inherit;
  }
`;

const Footer = styled.footer`
  padding: 24px 32px;

  border-top: 1px solid var(--color-layout-border);

  text-align: center;
  color: var(--color-text-secondary);
`;

const FEATURE_ICONS = [Lucide.Code2, Lucide.Zap, Lucide.Plug];

const LOCALE_STORAGE_KEY = 'homelib-website:locale';

export function App(): ReactElement {
  const [locale, setLocale] = useState<WebsiteLocale>(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);

      if (stored) {
        return resolveWebsiteLocale(stored);
      }
    } catch {
      // Ignore inaccessible storage.
    }

    return resolveWebsiteLocale(window.navigator.language);
  });

  const messages = WEBSITE_MESSAGES[locale];

  useEffect(() => {
    document.title = messages.docTitle;
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';

    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore inaccessible storage.
    }
  }, [locale, messages]);

  const switchLocale = (): void => {
    setLocale(locale === 'en' ? 'zh-CN' : 'en');
  };

  return (
    <>
      <GlobalStyle />
      <Page>
        <NavBar>
          <img src="homelib-text-light.svg" alt="HomeLib" height={32} />
          <NavLinks>
            <NavLink href="#features">{messages.nav.features}</NavLink>
            <NavLink href="https://github.com/homelib/homelib">
              {messages.nav.github}
            </NavLink>
            <LanguageToggle type="button" onClick={switchLocale}>
              {locale === 'en' ? '中文' : 'EN'}
            </LanguageToggle>
          </NavLinks>
        </NavBar>
        <Main>
          <Hero>
            <HeroTitle>{messages.hero.title}</HeroTitle>
            <HeroSubtitle>{messages.hero.subtitle}</HeroSubtitle>
            <Buttons>
              <PrimaryButton href="https://github.com/homelib/homelib#readme">
                {messages.hero.getStarted}
                <Lucide.ArrowRight size={16} />
              </PrimaryButton>
              <SecondaryButton href="https://github.com/homelib/homelib">
                <Lucide.GitBranch size={16} />
                {messages.hero.viewOnGitHub}
              </SecondaryButton>
            </Buttons>
          </Hero>
          <Features id="features">
            {messages.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index];

              return (
                <FeatureCard key={feature.title}>
                  <Icon />
                  <FeatureTitle>{feature.title}</FeatureTitle>
                  <FeatureDescription>{feature.description}</FeatureDescription>
                </FeatureCard>
              );
            })}
          </Features>
          <CodeSection>
            <CodeTitle>{messages.example.title}</CodeTitle>
            <CodeDescription>{messages.example.description}</CodeDescription>
            <CodeBlock dangerouslySetInnerHTML={{__html: codeHtml}} />
          </CodeSection>
        </Main>
        <Footer>{messages.footer}</Footer>
      </Page>
    </>
  );
}
