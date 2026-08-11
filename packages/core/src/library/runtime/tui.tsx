import {Box, Text, useInput} from 'ink';

import type {RuntimeProvider} from '../provider.js';

const PROVIDER_DETAILS_RENDERER_MAP = new Map<
  Function,
  ProviderDetailsRenderer
>();

export type ProviderDetailsComponentProps<TProvider extends RuntimeProvider> = {
  readonly provider: TProvider;
  readonly onBack: () => void;
};

export function registerProviderDetailsComponent<
  TConstructor extends abstract new (...args: never[]) => RuntimeProvider,
>(
  Provider: TConstructor,
  Component: React.ComponentType<
    ProviderDetailsComponentProps<InstanceType<TConstructor>>
  >,
): void {
  if (PROVIDER_DETAILS_RENDERER_MAP.has(Provider)) {
    throw new TypeError('Duplicate provider details component registration.');
  }

  PROVIDER_DETAILS_RENDERER_MAP.set(Provider, (provider, onBack) => {
    if (!isExactProviderInstance(provider, Provider)) {
      throw new TypeError(
        'Provider does not match its registered details component.',
      );
    }

    return <Component provider={provider} onBack={onBack} />;
  });
}

export type ProviderDetailsOutletProps = {
  readonly provider: RuntimeProvider;
  readonly onBack: () => void;
};

export function ProviderDetailsOutlet({
  provider,
  onBack,
}: ProviderDetailsOutletProps): React.JSX.Element {
  const renderer = PROVIDER_DETAILS_RENDERER_MAP.get(provider.constructor);

  if (renderer === undefined) {
    return <UnavailableProviderDetails onBack={onBack} />;
  }

  return renderer(provider, onBack);
}

type ProviderDetailsRenderer = (
  provider: RuntimeProvider,
  onBack: () => void,
) => React.JSX.Element;

type UnavailableProviderDetailsProps = {
  readonly onBack: () => void;
};

function UnavailableProviderDetails({
  onBack,
}: UnavailableProviderDetailsProps): React.JSX.Element {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>configuration unavailable.</Text>
      <Text dimColor>esc back</Text>
    </Box>
  );
}

function isExactProviderInstance<
  TConstructor extends abstract new (...args: never[]) => RuntimeProvider,
>(
  provider: RuntimeProvider,
  Provider: TConstructor,
): provider is InstanceType<TConstructor> {
  return provider.constructor === Provider;
}
