import {Box, Text} from 'ink';

import type {ProviderListItem} from './providers-page.js';

export type ProviderPageModel = {
  readonly scriptName: string;
  readonly provider: ProviderListItem;
};

export type ProviderPageProps = {
  readonly children: React.ReactNode;
  readonly model: ProviderPageModel;
};

export function ProviderPage({
  children,
  model,
}: ProviderPageProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>homelib · {model.scriptName}</Text>

      <Box marginTop={1}>
        <Text bold>
          providers / {model.provider.namespace} / {model.provider.name}
        </Text>
      </Box>

      <Box marginTop={1}>{children}</Box>

      <Box marginTop={1}>
        <Text dimColor>q menu · ctrl+c exit</Text>
      </Box>
    </Box>
  );
}
