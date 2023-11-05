import Express from 'express';

import {API} from '../definitions/index.js';

export class HTTPServer {
  readonly app: Express.Express = Express();

  constructor() {
    const {app} = this;

    for (const [key, route] of Object.entries(API)) {
      const [path, router] = item;

      app.use(path, router);
    }
  }

  listen() {}
}
