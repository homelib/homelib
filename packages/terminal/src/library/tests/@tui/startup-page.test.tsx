import {PassThrough} from 'node:stream';

import {createElement} from 'react';

test('highlights only a nonzero device count needing binding', async () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = '1';

  try {
    const {render} = await import('ink');
    const {StartupPage} = await import('../../@tui/startup-page.js');
    const renderFrame = async (unboundCount: number): Promise<string> => {
      const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
      const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
      let frame = '';

      Object.defineProperties(stdin, {
        isTTY: {value: true},
        setRawMode: {value: () => stdin},
        ref: {value: () => stdin},
        unref: {value: () => stdin},
      });
      Object.defineProperties(stdout, {
        isTTY: {value: true},
        columns: {value: 120},
        rows: {value: 40},
      });
      stdout.on('data', chunk => {
        frame = String(chunk);
      });

      const instance = render(
        createElement(StartupPage, {
          model: {
            scriptName: 'test',
            providerCount: 1,
            devices: {boundCount: 2, unboundCount},
          },
          onSelect: () => undefined,
        }),
        {
          stdin,
          stdout,
          debug: true,
          exitOnCtrlC: false,
          interactive: true,
          maxFps: 1_000,
          patchConsole: false,
        },
      );

      try {
        await instance.waitUntilRenderFlush();
        return frame;
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
        instance.cleanup();
        stdin.end();
        stdout.end();
      }
    };

    const attentionFrame = await renderFrame(1);
    const completeFrame = await renderFrame(0);

    expect(attentionFrame).toContain(
      '\u001B[2m2 bound · \u001B[22m\u001B[33m1 need binding\u001B[39m',
    );
    expect(completeFrame).toContain(
      '\u001B[2m2 bound · 0 need binding\u001B[22m',
    );
    expect(completeFrame).not.toContain('\u001B[33m');
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }
});
