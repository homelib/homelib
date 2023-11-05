import Express from 'express';

import {APIRoutes} from './@routes/index.js';

export class HTTPServer {
  readonly app: Express.Express = Express();

  constructor() {
    const {app} = this;

    for (const [key, route] of Object.entries(APIRoutes)) {
      if (!key.startsWith('route_')) {
        continue;
      }

      route(app);
    }
  }

  listen(port: number): void {
    this.app.listen(port, () => {
      console.info('api-server-serve', {port});
    });
  }
}
