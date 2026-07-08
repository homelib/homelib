import classNames from 'classnames';
import * as Lucide from 'lucide-react';
import type {ReactElement, ReactNode} from 'react';
import React, {useContext} from 'react';
import styled from 'styled-components';

import {ProtocolScopeDepthContext} from './@protocol-scope.js';

const Container = styled.div`
  --size: 28px;

  padding-left: calc(var(--depth, 0) * 10px);
  border-radius: 2px;

  display: flex;
  align-items: center;

  cursor: move;

  &:hover {
    background-color: var(--color-surface-hover);
  }

  &.highlight {
    background-color: var(--color-surface-highlight);
  }
`;

const Icon = styled.div`
  width: var(--size);
  height: var(--size);

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-icon-decorative);

  ${Container}:hover & {
    color: var(--color-icon-active);
  }

  ${Container}.highlight & {
    color: var(--color-icon-highlight);
  }

  > svg {
    width: 14px;
    height: 14px;
  }
`;

const Name = styled.div`
  margin-left: -2px;
  flex: 1;

  color: var(--color-text-secondary);

  ${Container}:hover & {
    color: var(--color-text-primary);
  }

  ${Container}.highlight & {
    color: var(--color-text-primary);
  }
`;

export function ProtocolDevice({
  icon,
  children,
  linked,
  highlight,
}: {
  icon: ReactNode;
  children: ReactNode;
  linked: boolean;
  highlight: boolean;
}): ReactElement {
  const depth = useContext(ProtocolScopeDepthContext);

  return (
    <Container
      className={classNames({highlight})}
      style={{'--depth': depth} as React.CSSProperties}
      draggable
    >
      <Icon>{icon}</Icon>
      <Name>{children}</Name>
      <Indicator linked={linked} />
    </Container>
  );
}

const IndicatorContainer = styled.div`
  width: var(--size);
  height: var(--size);

  display: flex;
  align-items: center;
  justify-content: center;

  &.linked {
    cursor: pointer;
  }

  > svg {
    width: 14px;
  }
`;

const DotIndicator = styled.div`
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: var(--color-icon-decorative);

  ${IndicatorContainer}.linked & {
    background: var(--color-icon-highlight);
  }

  ${IndicatorContainer}.linked:hover & {
    display: none;
  }
`;

const UnlinkIcon = styled(Lucide.Link2Off)`
  display: none;

  color: var(--color-unlink);

  ${IndicatorContainer}.linked:hover & {
    display: block;
  }
`;

function Indicator({linked}: {linked: boolean}): ReactElement {
  return (
    <IndicatorContainer
      className={classNames({linked})}
      title={linked ? 'Unlink' : undefined}
    >
      <DotIndicator />
      {linked && <UnlinkIcon />}
    </IndicatorContainer>
  );
}
