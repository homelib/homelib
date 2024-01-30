import {AsyncLocalStorage} from 'async_hooks';

import type {Scope} from '@homelib/core';
import {Server} from '@homelib/core';
import type {UpEntrances as UpEntrances_} from 'entrance-decorator';
import {entrance} from 'entrance-decorator';

export type EntrancesOptions = {
  password: string;
};

export class Entrances {
  constructor(
    readonly scope: Scope,
    readonly options: EntrancesOptions,
  ) {}

  /* eslint-disable @typescript-eslint/explicit-function-return-type */

  @entrance
  get server() {
    const server = new Server(this.scope);

    return server.start().then(() => server);
  }

  /* eslint-enable @typescript-eslint/explicit-function-return-type */
}

export type UpEntrances = UpEntrances_<Entrances, '*', never>;

export const entrancesStorage = new AsyncLocalStorage<Partial<UpEntrances>>();

export function useEntrances(): UpEntrances;
export function useEntrances(): object {
  const entrances = entrancesStorage.getStore();

  if (!entrances) {
    throw new Error('Entrances storage is empty');
  }

  return new Proxy(entrances, {
    get(target, key) {
      const value = (target as any)[key];

      if (value === undefined) {
        throw new Error(`Entrance ${JSON.stringify(key)} is undefined`);
      }

      return value;
    },
  });
}
