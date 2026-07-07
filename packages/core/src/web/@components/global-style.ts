import {createGlobalStyle} from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  :root {
    --color-accent: #ffc42d;
    --color-on-accent: #fff;

    --color-text-primary: #333;
    --color-text-secondary: #666;

    --color-icon-decorative: #ccc;
    --color-icon-active: #999;
    --color-icon-highlight: var(--color-accent);

    --color-surface-hover: #eee;
    --color-surface-highlight: #ffedbf;

    --color-layout-border: #ddd;

    --color-list-header-background: #f9f9f9;
    --color-list-separator: #eee;

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
    height: 100%;

    display: flex;
    flex-direction: column;
  }

  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    color: var(--color-text-primary);
  }

  a {
    color: inherit;
    text-decoration: none;
  }
`;
