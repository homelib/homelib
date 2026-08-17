import {Device} from './device.js';
import type {AirConditioner, Dehumidifier} from './devices/index.js';
import {$home, Home} from './home.js';
import {getRootScopes, register} from './registry.js';
import type {
  ScopeDeclarationBuilder,
  ScopeDeclarationChildren,
} from './scope-declaration.js';
import {Scope} from './scope.js';

export class TreeTestDevice extends Device {}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      treeTestDevice: TreeTestDevice;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {
      treeTest: TreeTestProviderDeviceConstructors;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface TreeTestProviderDeviceConstructors {
      device: TreeTestDevice;
    }
  }
}

register({
  treeTestDevice: TreeTestDevice,
});
register('treeTest', {
  device: TreeTestDevice,
});

/**
 * This export intentionally has no type annotation. Composite declaration
 * emit must be able to name the complete inferred tree in this test's `.d.ts`.
 */
export const treeDeclarationFixture = $home('tree declaration fixture', tree =>
  tree
    .$treeTestDevice('设备')
    .treeTest.$device('供应商设备')
    .$scope('房间', room => room.$treeTestDevice('设备')),
);

function declareBroadTree<TOwner>(
  tree: ScopeDeclarationBuilder<{}, TOwner>,
): ScopeDeclarationBuilder<ScopeDeclarationChildren, TOwner> {
  return tree.$treeTestDevice('实际设备');
}

test('materializes direct tree properties from the registered scope tree', () => {
  const home = treeDeclarationFixture;
  const room = home.房间;
  const scope: Scope = room;
  const rootDevice: TreeTestDevice = home.设备;
  const providerDevice: TreeTestDevice = home.供应商设备;
  const roomDevice: TreeTestDevice = room.设备;

  const [iteratedRoom] = [...home.scopes];
  const [rootDeviceEntry] = [...home.devices];
  const [roomDeviceEntry] = [...room.devices];

  expect(home).toBeInstanceOf(Home);
  expect(scope).toBeInstanceOf(Scope);
  expect(rootDevice).toBeInstanceOf(TreeTestDevice);
  expect(providerDevice).toBeInstanceOf(TreeTestDevice);
  expect(roomDevice).toBeInstanceOf(TreeTestDevice);
  expect(iteratedRoom).toBe(room);
  expect([...rootDeviceEntry.instances]).toEqual([rootDevice]);
  expect([...roomDeviceEntry.instances]).toEqual([roomDevice]);
  expect(home.path).toEqual(['tree declaration fixture']);
  expect(room.path).toEqual(['tree declaration fixture', '房间']);
  expect(Object.getOwnPropertyDescriptor(home, '设备')).toMatchObject({
    configurable: false,
    enumerable: true,
    value: rootDevice,
    writable: false,
  });
});

test('materializes only the immutable builder returned by the callback', () => {
  const home = $home('immutable declaration fixture', tree => {
    void tree.$treeTestDevice('被忽略的分支');

    return tree.$treeTestDevice('被返回的分支');
  });

  expect('被忽略的分支' in home).toBe(false);
  expect(home.被返回的分支).toBeInstanceOf(TreeTestDevice);
  expect([...home.devices].map(entry => entry.name)).toEqual(['被返回的分支']);
});

test('keeps the existing imperative declaration API', () => {
  const home = $home('imperative compatibility fixture');
  const room = home.$scope('传统房间');
  const device = room.$treeTestDevice('传统设备');

  expect(home).toBeInstanceOf(Home);
  expect(room).toBeInstanceOf(Scope);
  expect(device).toBeInstanceOf(TreeTestDevice);
  expect([...home.scopes]).toEqual([room]);
  expect([...room.devices].flatMap(entry => [...entry.instances])).toEqual([
    device,
  ]);
});

test('does not publish or reserve a home when its tree callback fails', () => {
  const homeName = 'atomic callback failure fixture';
  const rootScopesBefore = [...getRootScopes()];
  const callbackError = new Error('tree callback failed');

  expect(() =>
    $home(homeName, tree => {
      void tree
        .$treeTestDevice('未提交设备')
        .$scope('未提交房间', room => room.$treeTestDevice('未提交房间设备'));

      throw callbackError;
    }),
  ).toThrow(callbackError);

  expect([...getRootScopes()]).toEqual(rootScopesBefore);

  const retriedHome = $home(homeName, tree => tree.$treeTestDevice('重试设备'));

  expect(retriedHome.重试设备).toBeInstanceOf(TreeTestDevice);
});

test('rejects a duplicate home before evaluating its tree callback', () => {
  const name = 'duplicate callback fixture';
  let duplicateCallbackCalled = false;

  $home(name, tree => tree.$treeTestDevice('原设备'));

  expect(() =>
    $home(name, tree => {
      duplicateCallbackCalled = true;
      return tree.$treeTestDevice('不应创建的设备');
    }),
  ).toThrow(`Duplicate home: ${name}.`);
  expect(duplicateCallbackCalled).toBe(false);
});

function assertTreeDeclarationTypes(): void {
  const modeledHome = $home('美岸', tree =>
    tree
      .$motionSensor('人体传感器')
      .$motionAmbientLightLevelSensor('人体环境光传感器')
      .$scope('客厅', room =>
        room.$airConditioner('空调').$dehumidifier('除湿机'),
      ),
  );

  const motionDetected: boolean | undefined =
    modeledHome.人体环境光传感器.motionDetected;
  const ambientLightLevel: 'low' | 'high' | undefined =
    modeledHome.人体环境光传感器.ambientLightLevel;

  modeledHome.客厅.空调.turnOn();
  modeledHome.客厅.除湿机.turnOn();

  void motionDetected;
  void ambientLightLevel;

  const typedHome = $home('tree type fixture', tree =>
    tree
      .$treeTestDevice('根设备')
      .$scope('子范围', child => child.$treeTestDevice('子设备')),
  );
  const rootDevice: TreeTestDevice = typedHome.根设备;
  const childScope: Scope = typedHome.子范围;
  const childDevice: TreeTestDevice = typedHome.子范围.子设备;

  void rootDevice;
  void childScope;
  void childDevice;

  const condition = true as boolean;
  const conditionalHome = $home('conditional tree type fixture', tree =>
    condition ? tree.$treeTestDevice('分支一') : tree.$treeTestDevice('分支二'),
  );

  // @ts-expect-error -- Neither conditional key is guaranteed to exist.
  void conditionalHome.分支一;
  // @ts-expect-error -- Neither conditional key is guaranteed to exist.
  void conditionalHome.分支二;

  const conditionalDeviceHome = $home(
    'conditional device type fixture',
    tree =>
      condition ? tree.$airConditioner('设备') : tree.$dehumidifier('设备'),
  );
  const conditionalDevice: AirConditioner | Dehumidifier =
    conditionalDeviceHome.设备;
  // @ts-expect-error -- Either device type may be selected at runtime.
  const conditionalAirConditioner: AirConditioner = conditionalDeviceHome.设备;
  // @ts-expect-error -- Either device type may be selected at runtime.
  const conditionalDehumidifier: Dehumidifier = conditionalDeviceHome.设备;

  void conditionalDevice;
  void conditionalAirConditioner;
  void conditionalDehumidifier;

  const broadHome = $home('broad helper type fixture', declareBroadTree);

  // @ts-expect-error -- A broad helper cannot promise arbitrary direct keys.
  void broadHome.任意设备;

  // @ts-expect-error -- Undeclared children must not appear on a typed tree.
  void typedHome.不存在;
  // @ts-expect-error -- Materialized tree properties are readonly.
  typedHome.子范围.子设备 = typedHome.根设备;

  $home('duplicate device type fixture', tree =>
    tree
      .$treeTestDevice('重复')
      // @ts-expect-error -- Sibling device names must be unique.
      .$treeTestDevice('重复'),
  );

  $home('duplicate scope type fixture', tree =>
    tree
      .$scope('重复', child => child)
      // @ts-expect-error -- Sibling scope names must be unique.
      .$scope('重复', child => child),
  );

  $home('cross-kind duplicate type fixture', tree =>
    tree
      .$treeTestDevice('冲突')
      // @ts-expect-error -- Scopes and devices share one sibling namespace.
      .$scope('冲突', child => child),
  );

  $home('nested builder owner type fixture', outer =>
    // @ts-expect-error -- A nested callback must return its own builder.
    outer.$scope('嵌套', _inner => outer.$treeTestDevice('错误设备')),
  );

  $home('same path builder owner type fixture', outer =>
    outer.$scope('嵌套', first => {
      void outer.$scope(
        '嵌套',
        // @ts-expect-error -- Each callback invocation has a distinct owner.
        _second => first,
      );

      return first.$treeTestDevice('正确设备');
    }),
  );

  const dynamicName = '动态设备' as string;

  $home('dynamic name type fixture', tree =>
    // @ts-expect-error -- A typed declaration requires a single literal name.
    tree.$treeTestDevice(dynamicName),
  );

  const unionName = '设备一' as '设备一' | '设备二';

  $home('union name type fixture', tree =>
    // @ts-expect-error -- A union cannot imply that every member exists.
    tree.$treeTestDevice(unionName),
  );

  const patternedName = '设备-1' as `设备-${number}`;

  $home('template pattern name type fixture', tree =>
    // @ts-expect-error -- An infinite template pattern is not one concrete key.
    tree.$treeTestDevice(patternedName),
  );

  const concreteNumberedName = '设备-1' as const;
  const concreteNumberedHome = $home('concrete numbered name fixture', tree =>
    tree.$treeTestDevice(concreteNumberedName),
  );
  const concreteNumberedDevice: TreeTestDevice = concreteNumberedHome['设备-1'];

  void concreteNumberedDevice;

  $home('reserved name type fixture', tree =>
    // @ts-expect-error -- Scope API properties cannot be shadowed by children.
    tree.$treeTestDevice('name'),
  );

  $home('promise-like name type fixture', tree =>
    // @ts-expect-error -- A tree must not accidentally become promise-like.
    tree.$treeTestDevice('then'),
  );

  $home('legacy object name type fixture', tree =>
    // @ts-expect-error -- Runtime and type-level reserved names stay aligned.
    tree.$treeTestDevice('__defineGetter__'),
  );
}

void assertTreeDeclarationTypes;
