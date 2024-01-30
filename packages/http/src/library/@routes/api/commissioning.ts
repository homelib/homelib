import type {Express} from 'express';

import {API} from '../../../definitions/index.js';
import {route} from '../../@route.js';
import type {UpEntrances} from '../../entrances.js';

export function route_commissioning(app: Express, {server}: UpEntrances): void {
  route(app, API.commission).processor(async ({pairingCode}) => {
    await server.commission(pairingCode);
    return {};
  });
}
