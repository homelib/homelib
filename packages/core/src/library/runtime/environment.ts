import {homedir} from 'node:os';
import {join} from 'node:path';

export function getEnvironmentDirectory(): string {
  return process.env.HOMELIB_DIRECTORY ?? join(homedir(), '.homelib');
}
