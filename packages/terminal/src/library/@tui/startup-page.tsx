import {Box, Text, useInput} from 'ink';
import {useState} from 'react';

import {useTerminalI18n} from '../@i18n.js';

export type StartupPageModel = {
  readonly scriptName: string;
  readonly providerCount: number;
  readonly devices: {
    readonly boundCount: number;
    readonly unboundCount: number;
  };
};

export type StartupPageSelection = 'run' | 'providers' | 'bindings';

export type StartupPageProps = {
  readonly model: StartupPageModel;
  readonly onSelect: (selection: StartupPageSelection) => void;
};

export function StartupPage({
  model,
  onSelect,
}: StartupPageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    {label: messages.startup.run, selection: 'run'},
    {label: messages.common.providers, selection: 'providers'},
    {label: messages.common.bindings, selection: 'bindings'},
  ] as const satisfies readonly StartupPageItem[];

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(index => (index === 0 ? items.length - 1 : index - 1));
    } else if (key.downArrow) {
      setSelectedIndex(index => (index === items.length - 1 ? 0 : index + 1));
    } else if (key.return) {
      const item = items.at(selectedIndex);

      if (item !== undefined) {
        onSelect(item.selection);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>homelib · {model.scriptName}</Text>

      <Box flexDirection="column" marginTop={1}>
        {items.map((item, index) => (
          <StartupMenuItem
            key={item.selection}
            details={getItemDetails(item.selection, model, messages)}
            label={item.label}
            selected={index === selectedIndex}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{messages.startup.hint}</Text>
      </Box>
    </Box>
  );
}

type StartupMenuItemProps = {
  readonly details: React.ReactNode;
  readonly label: string;
  readonly selected: boolean;
};

function StartupMenuItem({
  details,
  label,
  selected,
}: StartupMenuItemProps): React.JSX.Element {
  return (
    <Box>
      <Box width={30}>
        <Text bold={selected} color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
          {label}
        </Text>
      </Box>

      {details}
    </Box>
  );
}

function getItemDetails(
  selection: StartupPageSelection,
  model: StartupPageModel,
  messages: ReturnType<typeof useTerminalI18n>,
): React.ReactNode {
  if (selection === 'providers') {
    return (
      <Text dimColor>
        {messages.startup.providerCount(model.providerCount)}
      </Text>
    );
  } else if (selection === 'bindings') {
    const needsBinding = model.devices.unboundCount > 0;

    return (
      <Text>
        <Text dimColor>
          {messages.startup.boundCount(model.devices.boundCount)} ·{' '}
        </Text>
        <Text
          color={needsBinding ? 'yellow' : undefined}
          dimColor={!needsBinding}
        >
          {messages.startup.needsBindingCount(model.devices.unboundCount)}
        </Text>
      </Text>
    );
  }

  return undefined;
}

type StartupPageItem = {
  readonly label: string;
  readonly selection: StartupPageSelection;
};
