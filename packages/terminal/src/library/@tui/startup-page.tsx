import {Box, Text, useInput} from 'ink';
import {useState} from 'react';

export type StartupPageModel = {
  readonly scriptName: string;
  readonly providerCount: number;
  readonly endpoints: {
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(index =>
        index === 0 ? STARTUP_PAGE_ITEMS.length - 1 : index - 1,
      );
    } else if (key.downArrow) {
      setSelectedIndex(index =>
        index === STARTUP_PAGE_ITEMS.length - 1 ? 0 : index + 1,
      );
    } else if (key.return) {
      const item = STARTUP_PAGE_ITEMS.at(selectedIndex);

      if (item !== undefined) {
        onSelect(item.selection);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>homelib · {model.scriptName}</Text>

      <Box flexDirection="column" marginTop={1}>
        {STARTUP_PAGE_ITEMS.map((item, index) => (
          <StartupMenuItem
            key={item.selection}
            details={getItemDetails(item.selection, model)}
            label={item.label}
            selected={index === selectedIndex}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ select · enter · ctrl+c exit</Text>
      </Box>
    </Box>
  );
}

type StartupMenuItemProps = {
  readonly details: string | undefined;
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

      {details !== undefined ? <Text dimColor>{details}</Text> : null}
    </Box>
  );
}

function getItemDetails(
  selection: StartupPageSelection,
  model: StartupPageModel,
): string | undefined {
  if (selection === 'providers') {
    return `${model.providerCount} declared`;
  } else if (selection === 'bindings') {
    return `${model.endpoints.boundCount} bound · ${model.endpoints.unboundCount} unbound`;
  }

  return undefined;
}

type StartupPageItem = {
  readonly label: string;
  readonly selection: StartupPageSelection;
};

const STARTUP_PAGE_ITEMS = [
  {label: 'run automation', selection: 'run'},
  {label: 'providers', selection: 'providers'},
  {label: 'bindings', selection: 'bindings'},
] as const satisfies readonly StartupPageItem[];
