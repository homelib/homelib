import {Server} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import type {LightEndpoint} from '@homelib/universal';
import {Command} from '@oclif/core';

import {ScopeArg} from '../@oclif/index.js';

export class ServeCommand extends Command {
  async run(): Promise<void> {
    const {
      args: {scope},
    } = await this.parse(ServeCommand);

    const server = new Server(scope);

    process.on('SIGINT', () => process.exit());

    await server.start();

    const light = server.getDeviceEndpoint(
      ['Living Room', 'Balcony'],
      'Light',
    ) as LightEndpoint;

    autorun(() => {
      console.log('light', {on: light.on});
    });

    // await server.link(
    //   scope._getDevice(['Living Room', 'Balcony'], 'Light')!,
    //   BigInt('4752343364536716295') as any,
    //   [1 as any],
    // );

    // await server.commission('34970112332');
  }

  static override args = {
    scope: ScopeArg({required: true}),
  };

  static override flags = {};
}
