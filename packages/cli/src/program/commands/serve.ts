import {once} from 'events';

import {$home, Server} from '@homelib/core';
import {Command} from '@oclif/core';

export class ServeCommand extends Command {
  async run(): Promise<void> {
    const home = $home('New Home');

    const server = new Server(home);

    await server.start();

    await once(process, 'SIGINT');

    process.exit(0);
  }
}
