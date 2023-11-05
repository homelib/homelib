import * as x from 'x-value';

declare global {
  namespace XValue {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Using extends UsingXData {}
  }

  type UsingXData = {
    'x-data': XDataTypes;
  };

  type XDataTypes = x.JSONTypes;
}

export const xData = x.json.extend<UsingXData>();
