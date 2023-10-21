import {resolve} from 'path';

import {CommissioningController} from '@project-chip/matter-node.js';
import {
  StorageBackendDisk,
  StorageManager,
} from '@project-chip/matter-node.js/storage';
import {MatterServer} from '@project-chip/matter.js';

import type {Scope} from './scopes/index.js';

const DATA_DIR_DEFAULT = resolve('.homelib/data');

export type ServerOptions = {
  /** Defaults to '.homelib/data' under cwd. */
  dataDir?: string;
};

export class Server {
  private matterStorageManager: StorageManager;

  private matterServer: MatterServer;

  private commissioningController: CommissioningController;

  readonly options: Readonly<Required<ServerOptions>>;

  constructor(
    readonly scope: Scope,
    options: ServerOptions = {},
  ) {
    const {dataDir = DATA_DIR_DEFAULT} = options;

    this.options = {dataDir};

    const matterStorage = new StorageBackendDisk(resolve(dataDir, 'matter'));

    this.matterStorageManager = new StorageManager(matterStorage);

    this.matterServer = new MatterServer(this.matterStorageManager);

    this.commissioningController = new CommissioningController({
      autoConnect: true,
    });
  }

  async start(): Promise<void> {
    await this.matterStorageManager.initialize();

    await this.matterServer.start();
  }
}
