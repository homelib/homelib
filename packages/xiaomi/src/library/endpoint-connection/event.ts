import type {MiotNotificationSource} from '../miot/index.js';

export function formatMiotEventLogString(
  description: string,
  source: MiotNotificationSource | undefined,
): string {
  return source === undefined ? description : `${description} source=${source}`;
}
