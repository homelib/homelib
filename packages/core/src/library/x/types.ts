import {x} from '@homelib/x';

export const DeviceId = x.string.nominal<'device id'>();

export type DeviceId = x.TypeOf<typeof DeviceId>;

export const DeviceName = x.string.nominal<'device name'>();

export type DeviceName = x.TypeOf<typeof DeviceName>;

export const ScopeName = x.string.nominal<'scope name'>();

export type ScopeName = x.TypeOf<typeof ScopeName>;

export const ScopePath = x.array(ScopeName);

export type ScopePath = x.TypeOf<typeof ScopePath>;

export const AutomationName = x.string.nominal<'automation name'>();

export type AutomationName = x.TypeOf<typeof AutomationName>;
