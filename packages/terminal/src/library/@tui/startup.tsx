import {
  type BindingFile,
  type BootstrapBindingDevice,
  type BootstrapBindingEndpoint,
  type BootstrapBindingScope,
  type BootstrapContext,
  type BootstrapProvider,
  type EndpointBinding,
  type EndpointPath,
  type ProviderBindingDevice,
  applyProviderBindingRequests,
  getEndpointPathKey,
  removeEndpointBinding,
} from '@homelib/core';
import {render, useApp, useInput} from 'ink';
import {useRef, useState} from 'react';

import {ProviderBindingOutlet, ProviderDetailsOutlet} from '../tui.js';

import {
  type BindingDeviceItem,
  BindingDevicePage,
  BindingProviderPage,
  type BindingScopeItem,
  BindingScopePage,
  BindingsPage,
  type StaleBindingItem,
  StaleBindingsPage,
  getBindingSummary,
} from './bindings-page.js';
import {ProviderPage} from './provider-page.js';
import {ProvidersPage} from './providers-page.js';
import {StartupPage, type StartupPageSelection} from './startup-page.js';

export type StartupTuiModel = {
  readonly scriptName: string;
  readonly providers: readonly BootstrapProvider[];
  readonly bindingScopes: readonly BootstrapBindingScope[];
  readonly bindingFile: BindingFile;
  readonly updateBindingFile: BootstrapContext['updateBindingFile'];
};

export async function presentStartup(
  context: BootstrapContext,
  scriptName: string,
): Promise<void> {
  if (!isInteractiveTerminal()) {
    return;
  }

  const model: StartupTuiModel = {
    scriptName,
    providers: context.providers,
    bindingScopes: context.bindingScopes,
    bindingFile: context.initialBindingFile,
    updateBindingFile: context.updateBindingFile,
  };
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

/** @internal */
export function Startup({model}: StartupProps): React.JSX.Element {
  const {exit} = useApp();
  const [page, setPage] = useState<StartupTuiPage>({type: 'startup'});
  const [bindingFile, setBindingFile] = useState(model.bindingFile);
  const bindingMutationQueueReference = useRef<Promise<void>>(
    Promise.resolve(),
  );

  const bindingScopeItems = createBindingScopeItems(
    model.bindingScopes,
    bindingFile,
  );
  const staleBindingItems = createStaleBindingItems(
    model.bindingScopes,
    bindingFile,
  );

  useInput(input => {
    if (input === 'q' && page.type !== 'startup') {
      setPage({type: 'startup'});
    }
  });

  const handleSelect = (selection: StartupPageSelection): void => {
    if (selection === 'run') {
      void bindingMutationQueueReference.current.then(() => {
        exit(selection);
      });
    } else if (selection === 'providers') {
      setPage({type: 'providers'});
    } else {
      setPage({type: 'bindings'});
    }
  };

  const mutateBindingFile = (
    createNextBindingFile: (currentBindingFile: BindingFile) => BindingFile,
  ): Promise<void> => {
    const operation = bindingMutationQueueReference.current.then(async () => {
      const nextBindingFile = await model.updateBindingFile(
        createNextBindingFile,
      );

      setBindingFile(nextBindingFile);
    });

    bindingMutationQueueReference.current = operation.catch(() => undefined);
    return operation;
  };

  if (page.type === 'bindings') {
    return (
      <BindingsPage
        model={{
          scriptName: model.scriptName,
          scopes: bindingScopeItems,
          staleBindingCount: staleBindingItems.length,
        }}
        onBack={() => {
          setPage({type: 'startup'});
        }}
        onSelect={scope => {
          setPage({type: 'binding-scope', scopePath: scope.path});
        }}
        onSelectStaleBindings={() => {
          setPage({type: 'stale-bindings'});
        }}
      />
    );
  } else if (page.type === 'stale-bindings') {
    return (
      <StaleBindingsPage
        model={{
          scriptName: model.scriptName,
          bindings: staleBindingItems,
        }}
        onBack={() => {
          setPage({type: 'bindings'});
        }}
        onRemove={async binding => {
          await mutateBindingFile(currentBindingFile => {
            const pathKey = getEndpointPathKey(binding.path);
            const bindingStillExists = currentBindingFile.bindings.some(
              item => getEndpointPathKey(item.endpoint) === pathKey,
            );

            if (!bindingStillExists) {
              throw new Error('stale binding no longer exists.');
            } else if (
              findStartupBindingEndpoint(model.bindingScopes, binding.path) !==
              undefined
            ) {
              throw new Error('endpoint binding is no longer stale.');
            }

            return removeEndpointBinding(currentBindingFile, binding.path);
          });
        }}
      />
    );
  } else if (page.type === 'binding-scope') {
    const scope = findBindingScopeItem(bindingScopeItems, page.scopePath);

    if (scope === undefined) {
      throw new TypeError('Unknown binding scope selected.');
    }

    return (
      <BindingScopePage
        key={JSON.stringify(scope.path)}
        model={{scriptName: model.scriptName, scope}}
        onBack={() => {
          const parent = findParentBindingScopeItem(
            bindingScopeItems,
            scope.path,
          );

          if (parent === undefined) {
            setPage({type: 'bindings'});
          } else {
            setPage({type: 'binding-scope', scopePath: parent.path});
          }
        }}
        onSelectScope={selectedScope => {
          setPage({type: 'binding-scope', scopePath: selectedScope.path});
        }}
        onSelectDevice={device => {
          setPage({
            type: 'binding-device',
            scopePath: scope.path,
            deviceName: device.name,
          });
        }}
      />
    );
  } else if (page.type === 'binding-device') {
    const device = findBindingDeviceItem(
      bindingScopeItems,
      page.scopePath,
      page.deviceName,
    );

    if (device === undefined) {
      throw new TypeError('Unknown binding device selected.');
    }

    return (
      <BindingDevicePage
        model={{
          scriptName: model.scriptName,
          scopePath: page.scopePath,
          device,
          providers: model.providers.map(({namespace, provider}) => ({
            namespace,
            name: provider.name,
            boundEndpointCount: getProviderBoundEndpointCount(
              page.scopePath,
              device,
              bindingFile,
              namespace,
              provider.name,
            ),
          })),
        }}
        onBack={() => {
          setPage({type: 'binding-scope', scopePath: page.scopePath});
        }}
        onSelectProvider={provider => {
          const providerItem = findProvider(
            model.providers,
            provider.namespace,
            provider.name,
          );

          if (providerItem === undefined) {
            throw new TypeError('Unknown binding provider selected.');
          }

          setPage({
            type: 'binding-provider',
            scopePath: page.scopePath,
            deviceName: page.deviceName,
            provider: providerItem,
          });
        }}
        onUnbind={async endpoint => {
          await mutateBindingFile(currentBindingFile => {
            const currentBinding = findEndpointBinding(
              currentBindingFile,
              endpoint.path,
            );

            if (currentBinding === undefined) {
              throw new Error('endpoint binding no longer exists.');
            } else if (
              currentBinding.provider.namespace !==
                endpoint.provider.namespace ||
              currentBinding.provider.name !== endpoint.provider.name
            ) {
              throw new Error('endpoint binding changed; go back and retry.');
            }

            return removeEndpointBinding(currentBindingFile, endpoint.path);
          });
        }}
      />
    );
  } else if (page.type === 'binding-provider') {
    const device = findStartupBindingDevice(
      model.bindingScopes,
      page.scopePath,
      page.deviceName,
    );

    if (device === undefined) {
      throw new TypeError('Unknown provider binding device selected.');
    }

    const providerReference = {
      namespace: page.provider.namespace,
      name: page.provider.provider.name,
    };
    const providerBindingDevice = createProviderBindingDevice(
      device,
      bindingFile,
    );
    const activeBindings = getActiveEndpointBindings(
      model.bindingScopes,
      bindingFile,
    );

    return (
      <BindingProviderPage
        model={{
          scriptName: model.scriptName,
          scopePath: page.scopePath,
          deviceName: page.deviceName,
          provider: providerReference,
        }}
      >
        <ProviderBindingOutlet
          bindings={activeBindings}
          device={providerBindingDevice}
          provider={page.provider.provider}
          providerReference={providerReference}
          onBack={() => {
            setPage({
              type: 'binding-device',
              scopePath: page.scopePath,
              deviceName: page.deviceName,
            });
          }}
          onComplete={() => {
            setPage({type: 'binding-scope', scopePath: page.scopePath});
          }}
          onBind={async requests => {
            await mutateBindingFile(currentBindingFile => {
              return applyProviderBindingRequests(
                currentBindingFile,
                requests,
                providerReference,
                page.provider.provider,
                providerBindingDevice,
                model.bindingScopes,
              );
            });
          }}
        />
      </BindingProviderPage>
    );
  } else if (page.type === 'providers') {
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
          const providerItem = findProvider(
            model.providers,
            provider.namespace,
            provider.name,
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

  const bindingSummary = getBindingSummary(bindingScopeItems);

  return (
    <StartupPage
      model={{
        scriptName: model.scriptName,
        providerCount: model.providers.length,
        endpoints: {
          boundCount: bindingSummary.configuredEndpointCount,
          unboundCount: bindingSummary.unconfiguredEndpointCount,
        },
      }}
      onSelect={handleSelect}
    />
  );
}

type StartupTuiPage =
  | {readonly type: 'startup'}
  | {readonly type: 'bindings'}
  | {readonly type: 'stale-bindings'}
  | {readonly type: 'binding-scope'; readonly scopePath: readonly string[]}
  | {
      readonly type: 'binding-device';
      readonly scopePath: readonly string[];
      readonly deviceName: string;
    }
  | {
      readonly type: 'binding-provider';
      readonly scopePath: readonly string[];
      readonly deviceName: string;
      readonly provider: BootstrapProvider;
    }
  | {readonly type: 'providers'}
  | {readonly type: 'provider'; readonly provider: BootstrapProvider};

function createBindingScopeItems(
  scopes: readonly BootstrapBindingScope[],
  bindingFile: BindingFile,
): readonly BindingScopeItem[] {
  return scopes.map(scope => createBindingScopeItem(scope, bindingFile));
}

function createBindingScopeItem(
  scope: BootstrapBindingScope,
  bindingFile: BindingFile,
): BindingScopeItem {
  return {
    path: scope.path,
    scopes: scope.scopes.map(childScope =>
      createBindingScopeItem(childScope, bindingFile),
    ),
    devices: scope.devices.map(device => ({
      name: device.name,
      endpoints: device.endpoints.map(endpoint => {
        const binding = findEndpointBinding(bindingFile, endpoint.path);

        return {
          path: endpoint.path,
          name: endpoint.endpoint.name,
          provider: binding?.provider,
        };
      }),
    })),
  };
}

function createStaleBindingItems(
  scopes: readonly BootstrapBindingScope[],
  bindingFile: BindingFile,
): readonly StaleBindingItem[] {
  return bindingFile.bindings.flatMap(binding =>
    findStartupBindingEndpoint(scopes, binding.endpoint) === undefined
      ? [{path: binding.endpoint, provider: binding.provider}]
      : [],
  );
}

/** @internal */
export function getActiveEndpointBindings(
  scopes: readonly BootstrapBindingScope[],
  bindingFile: BindingFile,
): readonly EndpointBinding[] {
  return bindingFile.bindings.filter(
    binding =>
      findStartupBindingEndpoint(scopes, binding.endpoint) !== undefined,
  );
}

/** @internal */
export function createProviderBindingDevice(
  device: BootstrapBindingDevice,
  bindingFile: BindingFile,
): ProviderBindingDevice {
  const bindingMap = new Map(
    bindingFile.bindings.map(binding => [
      getEndpointPathKey(binding.endpoint),
      binding,
    ]),
  );

  return {
    name: device.name,
    deviceConstructors: device.deviceConstructors,
    endpoints: device.endpoints.map(endpoint => ({
      path: endpoint.path,
      endpoint: endpoint.endpoint,
      binding: bindingMap.get(getEndpointPathKey(endpoint.path)),
    })),
  };
}

function findBindingScopeItem(
  scopes: readonly BindingScopeItem[],
  path: readonly string[],
): BindingScopeItem | undefined {
  for (const scope of scopes) {
    if (pathsEqual(scope.path, path)) {
      return scope;
    }

    const child = findBindingScopeItem(scope.scopes, path);

    if (child !== undefined) {
      return child;
    }
  }

  return undefined;
}

function findParentBindingScopeItem(
  scopes: readonly BindingScopeItem[],
  path: readonly string[],
): BindingScopeItem | undefined {
  for (const scope of scopes) {
    if (scope.scopes.some(child => pathsEqual(child.path, path))) {
      return scope;
    }

    const parent = findParentBindingScopeItem(scope.scopes, path);

    if (parent !== undefined) {
      return parent;
    }
  }

  return undefined;
}

function findBindingDeviceItem(
  scopes: readonly BindingScopeItem[],
  scopePath: readonly string[],
  deviceName: string,
): BindingDeviceItem | undefined {
  return findBindingScopeItem(scopes, scopePath)?.devices.find(
    device => device.name === deviceName,
  );
}

function findStartupBindingDevice(
  scopes: readonly BootstrapBindingScope[],
  scopePath: readonly string[],
  deviceName: string,
): BootstrapBindingDevice | undefined {
  for (const scope of scopes) {
    if (pathsEqual(scope.path, scopePath)) {
      return scope.devices.find(device => device.name === deviceName);
    }

    const device = findStartupBindingDevice(
      scope.scopes,
      scopePath,
      deviceName,
    );

    if (device !== undefined) {
      return device;
    }
  }

  return undefined;
}

function findProvider(
  providers: readonly BootstrapProvider[],
  namespace: string,
  name: string,
): BootstrapProvider | undefined {
  return providers.find(
    item => item.namespace === namespace && item.provider.name === name,
  );
}

function findEndpointBinding(
  bindingFile: BindingFile,
  path: EndpointPath,
): EndpointBinding | undefined {
  const pathKey = getEndpointPathKey(path);

  return bindingFile.bindings.find(
    binding => getEndpointPathKey(binding.endpoint) === pathKey,
  );
}

function findStartupBindingEndpoint(
  scopes: readonly BootstrapBindingScope[],
  path: EndpointPath,
): BootstrapBindingEndpoint | undefined {
  const pathKey = getEndpointPathKey(path);

  for (const scope of scopes) {
    for (const device of scope.devices) {
      const endpoint = device.endpoints.find(
        item => getEndpointPathKey(item.path) === pathKey,
      );

      if (endpoint !== undefined) {
        return endpoint;
      }
    }

    const endpoint = findStartupBindingEndpoint(scope.scopes, path);

    if (endpoint !== undefined) {
      return endpoint;
    }
  }

  return undefined;
}

function getProviderBoundEndpointCount(
  scopePath: readonly string[],
  device: BindingDeviceItem,
  bindingFile: BindingFile,
  namespace: string,
  providerName: string,
): number {
  const deviceEndpointNameSet = new Set(
    device.endpoints.map(endpoint => endpoint.name),
  );

  return bindingFile.bindings.filter(
    binding =>
      binding.provider.namespace === namespace &&
      binding.provider.name === providerName &&
      pathsEqual(binding.endpoint.scopePath, scopePath) &&
      binding.endpoint.deviceName === device.name &&
      deviceEndpointNameSet.has(binding.endpoint.endpointName),
  ).length;
}

function pathsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

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
