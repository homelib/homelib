import {x} from '@homelib/x';

export const DeviceId = x.string.nominal<'device id'>();

export type DeviceId = x.TypeOf<typeof DeviceId>;

export const DevicePath = x.tuple([x.array(x.string), x.string]);

export type DevicePath = x.TypeOf<typeof DevicePath>;
