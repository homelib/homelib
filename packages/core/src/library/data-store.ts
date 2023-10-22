import {readFileSync, writeFileSync} from 'fs';

import {autorun, observable} from 'mobx';

export class DataStore<T extends object> {
  readonly data: T;

  dispose: () => void;

  constructor(
    readonly path: string,
    readonly defaults: () => T,
  ) {
    let raw: T;

    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = defaults();
    }

    this.data = observable(raw);

    this.dispose = autorun(() => {
      const json = JSON.stringify(this.data, undefined, 2);

      writeFileSync(path, json);
    });
  }
}
