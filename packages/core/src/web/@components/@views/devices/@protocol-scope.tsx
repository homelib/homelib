import {Folder} from 'lucide-react';
import type {ReactElement, ReactNode} from 'react';
import React, {createContext, useContext} from 'react';
import styled from 'styled-components';

export const ProtocolScopeDepthContext = createContext(0);

const Container = styled.div`
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  --size: 28px;

  display: flex;
  align-items: center;

  padding: 0 12px 0 calc(var(--depth, 0) * 10px);
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

  > svg {
    width: 14px;
    height: 14px;
  }
`;

const Name = styled.div`
  color: var(--color-text-secondary);

  ${Container}:hover & {
    color: var(--color-text-primary);
  }
`;

export function ProtocolScope({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): ReactElement {
  const depth = useContext(ProtocolScopeDepthContext);

  return (
    <Container>
      <Header style={{'--depth': depth} as React.CSSProperties}>
        <Icon>
          <Folder />
        </Icon>
        <Name>{name}</Name>
      </Header>
      <ProtocolScopeDepthContext.Provider value={depth + 1}>
        {children}
      </ProtocolScopeDepthContext.Provider>
    </Container>
  );
}
