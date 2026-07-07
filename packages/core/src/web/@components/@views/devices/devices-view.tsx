import type {LucideIcon} from 'lucide-react';
import {
  DoorClosedLocked,
  Folder,
  HousePlug,
  Lightbulb,
  Link2,
  Link2Off,
  Tv,
  Wind,
} from 'lucide-react';
import type {ReactElement} from 'react';
import React from 'react';
import styled from 'styled-components';

import {Column, FitContainer} from '../../@layout.js';

import {HomeDevice} from './@home-device.js';
import {HomeScope} from './@home-scope.js';

const LeftColumn = styled(Column)`
  flex: 1;

  padding: 10px;
`;

const RightColumn = styled(Column)`
  flex: 1;
`;

export function DevicesView(): ReactElement {
  return (
    <FitContainer>
      <LeftColumn>
        <HomeScope name="Home 1" leaf={false}>
          <HomeDevice icon={<DoorClosedLocked />} bind={true} selected={false}>
            Door lock
          </HomeDevice>
          <HomeScope name="Living room" leaf={true}>
            <HomeDevice icon={<Lightbulb />} bind={0} selected={false}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Lightbulb />} bind={2} selected={false}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Lightbulb />} bind={2} selected={true}>
              Lights
            </HomeDevice>
            <HomeDevice icon={<Wind />} bind={false} selected={false}>
              Fan
            </HomeDevice>
            <HomeDevice icon={<Wind />} bind={true} selected={false}>
              Fan
            </HomeDevice>
          </HomeScope>
        </HomeScope>
      </LeftColumn>
      <RightColumn>2</RightColumn>
    </FitContainer>
  );
}
