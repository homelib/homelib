import * as x from 'x-value';

declare global {
  namespace XValue {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Using extends UsingXNode {}
  }

  type UsingXNode = {
    'x-node': XNodeTypes;
  };

  type XNodeTypes = x.ECMAScriptTypes;
}

export const xNode = x.ecmascript.extend<UsingXNode>({
  codecs: {},
});
