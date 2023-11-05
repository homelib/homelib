import * as x from 'x-value';

declare global {
  namespace XValue {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Using extends UsingXBrowser {}
  }

  type UsingXBrowser = {
    'x-browser': XBrowserTypes;
  };

  type XBrowserTypes = x.ECMAScriptTypes;
}

export const xBrowser = x.ecmascript.extend<UsingXBrowser>({
  codecs: {},
});
