import {render, useApp} from 'ink';
import {useState} from 'react';

import type {RuntimeProvider} from '../../provider.js';
import {ProviderDetailsOutlet} from '../tui.js';

import {ProviderPage} from './provider-page.js';
import {ProvidersPage} from './providers-page.js';
import {
  StartupPage,
  type StartupPageModel,
  type StartupPageSelection,
} from './startup-page.js';

export type StartupTuiModel = {
  readonly scriptName: string;
  readonly providers: readonly StartupTuiProvider[];
  readonly endpoints: StartupPageModel['endpoints'];
};

type StartupTuiProvider = {
  readonly namespace: string;
  readonly provider: RuntimeProvider;
};

export async function presentStartup(model: StartupTuiModel): Promise<void> {
  if (!isInteractiveTerminal()) {
    return;
  }

  const instance = render(<Startup model={model} />, {alternateScreen: true});
  let result: unknown;

  try {
    result = await instance.waitUntilExit();
  } finally {
    instance.cleanup();
  }

  if (result === 'run') {
    return;
  } else if (result === undefined) {
    await interruptProcess();
  }

  throw new TypeError('Unexpected startup page result.');
}

type StartupProps = {
  readonly model: StartupTuiModel;
};

function Startup({model}: StartupProps): React.JSX.Element {
  const {exit} = useApp();
  const [page, setPage] = useState<StartupTuiPage>({type: 'startup'});

  const handleSelect = (selection: StartupPageSelection): void => {
    if (selection === 'run') {
      exit(selection);
    } else if (selection === 'providers') {
      setPage({type: 'providers'});
    } else {
      // TODO: Open the bindings page.
    }
  };

  if (page.type === 'providers') {
    return (
      <ProvidersPage
        model={{
          scriptName: model.scriptName,
          providers: model.providers.map(({namespace, provider}) => ({
            namespace,
            name: provider.name,
          })),
        }}
        onBack={() => {
          setPage({type: 'startup'});
        }}
        onSelect={provider => {
          const providerItem = model.providers.find(
            item =>
              item.namespace === provider.namespace &&
              item.provider.name === provider.name,
          );

          if (providerItem === undefined) {
            throw new TypeError('Unknown provider selected.');
          }

          setPage({type: 'provider', provider: providerItem});
        }}
      />
    );
  } else if (page.type === 'provider') {
    const onBack = (): void => {
      setPage({type: 'providers'});
    };

    return (
      <ProviderPage
        model={{
          scriptName: model.scriptName,
          provider: {
            namespace: page.provider.namespace,
            name: page.provider.provider.name,
          },
        }}
      >
        <ProviderDetailsOutlet
          provider={page.provider.provider}
          onBack={onBack}
        />
      </ProviderPage>
    );
  }

  return (
    <StartupPage
      model={{
        scriptName: model.scriptName,
        providerCount: model.providers.length,
        endpoints: model.endpoints,
      }}
      onSelect={handleSelect}
    />
  );
}

type StartupTuiPage =
  | {readonly type: 'startup'}
  | {readonly type: 'providers'}
  | {readonly type: 'provider'; readonly provider: StartupTuiProvider};

function isInteractiveTerminal(): boolean {
  const stdinIsTty = process.stdin.isTTY;
  const stdoutIsTty = process.stdout.isTTY;

  if (stdinIsTty === undefined || stdoutIsTty === undefined) {
    return false;
  }

  return stdinIsTty && stdoutIsTty;
}

function interruptProcess(): Promise<never> {
  process.kill(process.pid, 'SIGINT');
  return new Promise<never>(() => undefined);
}
