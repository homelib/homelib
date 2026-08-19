import {Box, Text, useInput} from 'ink';
import {useState} from 'react';

import {useTerminalI18n} from '../@i18n.js';

export type ProviderListItem = {
  readonly namespace: string;
  readonly name: string;
};

export type ProvidersPageModel = {
  readonly scriptName: string;
  readonly providers: readonly ProviderListItem[];
};

export type ProvidersPageProps = {
  readonly model: ProvidersPageModel;
  readonly onBack: () => void;
  readonly onSelect: (provider: ProviderListItem) => void;
};

export function ProvidersPage({
  model,
  onBack,
  onSelect,
}: ProvidersPageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow && model.providers.length > 0) {
      setSelectedIndex(index =>
        index === 0 ? model.providers.length - 1 : index - 1,
      );
    } else if (key.downArrow && model.providers.length > 0) {
      setSelectedIndex(index =>
        index === model.providers.length - 1 ? 0 : index + 1,
      );
    } else if (key.return) {
      const provider = model.providers.at(selectedIndex);

      if (provider !== undefined) {
        onSelect(provider);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>homelib · {model.scriptName}</Text>

      <Box marginTop={1}>
        <Text bold>{messages.common.providers}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {model.providers.length === 0 ? (
          <Text dimColor>{messages.common.noProviders}</Text>
        ) : (
          model.providers.map((provider, index) => (
            <ProviderItem
              key={getProviderKey(provider)}
              provider={provider}
              selected={index === selectedIndex}
            />
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{messages.providers.hint}</Text>
      </Box>
    </Box>
  );
}

type ProviderItemProps = {
  readonly provider: ProviderListItem;
  readonly selected: boolean;
};

function ProviderItem({
  provider,
  selected,
}: ProviderItemProps): React.JSX.Element {
  return (
    <Text bold={selected} color={selected ? 'cyan' : undefined}>
      {selected ? '› ' : '  '}
      {provider.namespace} / {provider.name}
    </Text>
  );
}

function getProviderKey(provider: ProviderListItem): string {
  return JSON.stringify([provider.namespace, provider.name]);
}
