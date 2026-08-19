import type {
  ProviderBindingDevice,
  ProviderBindingRecord,
  ProviderBindingRequest,
  RuntimeProvider,
} from '@homelib/core';
import {Box, Text, useInput} from 'ink';

import {useTerminalI18n} from './@i18n.js';

const PROVIDER_DETAILS_RENDERER_MAP = new Map<
  Function,
  ProviderDetailsRenderer
>();
const PROVIDER_BINDING_RENDERER_MAP = new Map<
  Function,
  ProviderBindingRenderer
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

export type ProviderBindingComponentProps<TProvider extends RuntimeProvider> = {
  readonly provider: TProvider;
  readonly device: ProviderBindingDevice;
  readonly providerBindings: readonly ProviderBindingRecord[];
  readonly onBind: (
    requests: readonly ProviderBindingRequest[],
  ) => Promise<void>;
  readonly onBack: () => void;
  readonly onComplete: () => void;
};

export function registerProviderBindingComponent<
  TConstructor extends abstract new (...args: never[]) => RuntimeProvider,
>(
  Provider: TConstructor,
  Component: React.ComponentType<
    ProviderBindingComponentProps<InstanceType<TConstructor>>
  >,
): void {
  if (PROVIDER_BINDING_RENDERER_MAP.has(Provider)) {
    throw new TypeError('Duplicate provider binding component registration.');
  }

  PROVIDER_BINDING_RENDERER_MAP.set(Provider, props => {
    const {provider, ...componentProps} = props;

    if (!isExactProviderInstance(provider, Provider)) {
      throw new TypeError(
        'Provider does not match its registered binding component.',
      );
    }

    return <Component {...componentProps} provider={provider} />;
  });
}

export type ProviderBindingOutletProps = {
  readonly provider: RuntimeProvider;
  readonly device: ProviderBindingDevice;
  readonly providerBindings: readonly ProviderBindingRecord[];
  readonly onBind: (
    requests: readonly ProviderBindingRequest[],
  ) => Promise<void>;
  readonly onBack: () => void;
  readonly onComplete: () => void;
};

export function ProviderBindingOutlet({
  provider,
  device,
  providerBindings,
  onBind,
  onBack,
  onComplete,
}: ProviderBindingOutletProps): React.JSX.Element {
  const renderer = PROVIDER_BINDING_RENDERER_MAP.get(provider.constructor);

  if (renderer === undefined) {
    return <UnavailableProviderBinding onBack={onBack} />;
  }

  return renderer({
    provider,
    device,
    providerBindings,
    onBind,
    onBack,
    onComplete,
  });
}

type ProviderDetailsRenderer = (
  provider: RuntimeProvider,
  onBack: () => void,
) => React.JSX.Element;

type ProviderBindingRenderer = (
  props: ProviderBindingComponentProps<RuntimeProvider>,
) => React.JSX.Element;

type UnavailableProviderDetailsProps = {
  readonly onBack: () => void;
};

function UnavailableProviderDetails({
  onBack,
}: UnavailableProviderDetailsProps): React.JSX.Element {
  const messages = useTerminalI18n();
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>{messages.common.configurationUnavailable}</Text>
      <Text dimColor>{messages.hints.unavailable}</Text>
    </Box>
  );
}

function UnavailableProviderBinding({
  onBack,
}: UnavailableProviderDetailsProps): React.JSX.Element {
  const messages = useTerminalI18n();
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>{messages.common.bindingUnavailable}</Text>
      <Text dimColor>{messages.hints.unavailable}</Text>
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
