import {styleText} from 'node:util';

export type LogColorMode = 'auto' | 'always' | 'never';

export function formatLogText(
  format: Parameters<typeof styleText>[0],
  text: string,
  colorMode: LogColorMode = 'auto',
): string {
  if (colorMode === 'never') {
    return text;
  }

  return styleText(
    format,
    text,
    colorMode === 'always' ? {validateStream: false} : undefined,
  );
}
