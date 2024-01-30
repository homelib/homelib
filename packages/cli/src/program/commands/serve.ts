import {HTTPServer} from '@homelib/http';
import {Command} from '@oclif/core';

import {ScopeArg} from '../@oclif/index.js';

export class ServeCommand extends Command {
  async run(): Promise<void> {
    const {
      args: {scope},
    } = await this.parse(ServeCommand);

    process.on('SIGINT', () => process.exit());

    // await server.start();

    // const light = server.getDeviceEndpoint(
    //   ['Living Room', 'Balcony'],
    //   'Light',
    // ) as LightEndpoint;

    // autorun(() => {
    //   console.log('light', {on: light.turnedOn});
    // });

    const httpServer = await HTTPServer.create(scope, {password: '12345678'});

    httpServer.listen(10047);

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
