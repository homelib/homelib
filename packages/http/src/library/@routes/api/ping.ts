import type {Express} from 'express';

import {API} from '../../../definitions/index.js';
import {route} from '../../@route.js';

export function route_ping(app: Express): void {
  route(app, API.ping).processor(() => {
    return {};
  });
}
