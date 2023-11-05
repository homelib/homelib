import type {DeviceCardProps} from '@homelib/core/browser';
import type {ReactElement} from 'react';
import React from 'react';

import type {LightCard} from '../../library/index.js';

export type LightCardProps = DeviceCardProps<LightCard>;

export default ({devices: {light}, scope}: LightCardProps): ReactElement => {
  return <div></div>;
};
