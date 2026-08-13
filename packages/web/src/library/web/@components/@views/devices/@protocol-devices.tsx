import * as Lucide from 'lucide-react';
import type {ReactElement} from 'react';
import React from 'react';
import styled from 'styled-components';

import {ProtocolDevice} from './@protocol-device.js';
import {ProtocolDevicesGroup} from './@protocol-devices-group.js';
import {ProtocolScope} from './@protocol-scope.js';

const Container = styled.div`
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  height: 32px;
  padding: 0 12px;

  display: flex;
  justify-content: space-between;
  align-items: center;

  border-bottom: 1px solid var(--color-layout-border);
  background-color: var(--color-list-header-background);
`;

const HeaderText = styled.div`
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
`;

const ProtocolDevicesCount = styled.div`
  font-size: 13px;
  color: var(--color-text-secondary);
`;

export function ProtocolDevicesColumn({
  className,
}: {
  className?: string;
}): ReactElement {
  return (
    <Container className={className}>
      <Header>
        <HeaderText>Protocol Devices</HeaderText>
        <ProtocolDevicesCount>10</ProtocolDevicesCount>
      </Header>
      <ProtocolDevicesGroup name="Home 1 - MIoT">
        <ProtocolScope name="Living room">
          <ProtocolDevice
            icon={<Lucide.Lightbulb />}
            linked={true}
            highlight={true}
          >
            Some light
          </ProtocolDevice>
          <ProtocolScope name="Desk">
            <ProtocolDevice
              icon={<Lucide.Lightbulb />}
              linked={false}
              highlight={false}
            >
              Some light
            </ProtocolDevice>
          </ProtocolScope>
        </ProtocolScope>
      </ProtocolDevicesGroup>
      <ProtocolDevicesGroup name="Home 1 - Matter">
        <ProtocolDevice
          icon={<Lucide.Lightbulb />}
          linked={true}
          highlight={false}
        >
          Some light
        </ProtocolDevice>
      </ProtocolDevicesGroup>
      <ProtocolDevicesGroup name="Home 2 - MIoT">
        <ProtocolDevice
          icon={<Lucide.Lightbulb />}
          linked={false}
          highlight={false}
        >
          Some light
        </ProtocolDevice>
      </ProtocolDevicesGroup>
      <ProtocolDevicesGroup name="Home 3 - Matter">
        <ProtocolDevice
          icon={<Lucide.Lightbulb />}
          linked={false}
          highlight={false}
        >
          Some light
        </ProtocolDevice>
      </ProtocolDevicesGroup>
    </Container>
  );
}
