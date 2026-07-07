import {routra} from 'routra';
import {BrowserRouterPlugin} from 'routra/browser';

export const router = routra({
  default: true,
  devices: true,
});

router.$use(
  new BrowserRouterPlugin({
    default: router.default,
  }),
);
