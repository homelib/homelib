import * as Lucide from 'lucide-react';
import type {ReactElement} from 'react';
import React from 'react';
import styled from 'styled-components';

import {Column, FitContainer} from '../../@layout.js';

import {HomeDevice} from './@home-device.js';
import {HomeScope} from './@home-scope.js';
import {ProtocolDevicesColumn} from './@protocol-devices.js';

const LeftColumn = styled(Column)`
  flex: 1;

  padding: 10px;
`;

const RightColumn = styled(ProtocolDevicesColumn)`
  flex: 1;
`;

export function DevicesView(): ReactElement {
  return (
    <FitContainer>
      <LeftColumn>
        <HomeScope name="Home 1" leaf={false}>
          <HomeDevice
            icon={<Lucide.DoorClosedLocked />}
            linked={true}
            selected={false}
          >
            Door lock
          </HomeDevice>
          <HomeScope name="Living room" leaf={true}>
            <HomeDevice icon={<Lucide.Lightbulb />} linked={0} selected={false}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Lucide.Lightbulb />} linked={2} selected={false}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Lucide.Lightbulb />} linked={2} selected={true}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Lucide.Wind />} linked={false} selected={false}>
              Fan
            </HomeDevice>
            <HomeDevice icon={<Lucide.Wind />} linked={true} selected={false}>
              Fan
            </HomeDevice>
          </HomeScope>
        </HomeScope>
      </LeftColumn>
      <RightColumn />
    </FitContainer>
  );
}
