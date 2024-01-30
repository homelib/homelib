import type {Scope} from '@homelib/core';
import {up} from 'entrance-decorator';
import Express from 'express';

import {APIRoutes} from './@routes/index.js';
import {
  Entrances,
  type EntrancesOptions,
  type UpEntrances,
} from './entrances.js';

export type HTTPServerOptions = EntrancesOptions;

export class HTTPServer {
  readonly app: Express.Express = Express();

  constructor(readonly entrances: UpEntrances) {
    const {app} = this;

    app.use(Express.json());

    for (const [key, route] of Object.entries(APIRoutes)) {
      if (!key.startsWith('route_')) {
        continue;
      }

      route(app, entrances);
    }
  }

  listen(port: number): void {
    this.app.listen(port, () => {
      console.info('api-server-serve', {port});
    });
  }

  static async create(
    scope: Scope,
    options: HTTPServerOptions,
  ): Promise<HTTPServer> {
    const entrances = await up(new Entrances(scope, options));
    return new HTTPServer(entrances);
  }
}
