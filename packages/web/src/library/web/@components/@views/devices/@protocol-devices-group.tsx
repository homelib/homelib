import classNames from 'classnames';
import * as Lucide from 'lucide-react';
import type {ReactElement, ReactNode} from 'react';
import React, {useState} from 'react';
import styled from 'styled-components';

const Container = styled.div`
  border-bottom: 1px solid var(--color-list-separator);

  display: flex;
  flex-direction: column;

  &.expanded {
    border-bottom-color: var(--color-layout-border);
  }

  &:has(+ &.expanded) {
    border-bottom-color: var(--color-layout-border);
  }
`;

const Header = styled.div`
  --size: 32px;

  display: flex;
  align-items: center;

  border-bottom: 0px dashed var(--color-list-separator);
  padding: 0 12px 0 2px;

  cursor: default;

  &:hover {
    background-color: var(--color-surface-hover);
  }

  ${Container}.expanded & {
    border-bottom-width: 1px;
  }
`;

const HeaderIcon = styled.div`
  width: var(--size);
  height: var(--size);

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-icon-decorative);

  ${Container}.expanded & {
    color: var(--color-icon-active);
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const HeaderText = styled.div`
  flex: 1;
  margin-left: -2px;
  color: var(--color-text-secondary);

  ${Container}.expanded & {
    color: var(--color-text-primary);
  }
`;

const HeaderCounts = styled.div`
  display: flex;
  align-items: center;

  font-size: 13px;
`;

const HeaderLinkCount = styled.div`
  color: var(--color-accent);
`;

const HeaderTotalCount = styled.div`
  color: var(--color-text-secondary);
`;

const HeaderCountsSeparator = styled.div`
  color: var(--color-text-secondary);
  margin: 0 3px;

  &::before {
    content: '/';
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;

  padding: 5px;
`;

export function ProtocolDevicesGroup({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <Container className={classNames({expanded})}>
      <Header onClick={() => setExpanded(!expanded)}>
        <HeaderIcon>
          <Lucide.HousePlug />
        </HeaderIcon>
        <HeaderText>{name}</HeaderText>
        <HeaderCounts>
          <HeaderLinkCount>10</HeaderLinkCount>
          <HeaderCountsSeparator />
          <HeaderTotalCount>10</HeaderTotalCount>
        </HeaderCounts>
      </Header>
      {expanded && <List>{children}</List>}
    </Container>
  );
}
