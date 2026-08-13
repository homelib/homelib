import classNames from 'classnames';
import type {ReactElement, ReactNode} from 'react';
import React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  border: 1px solid var(--color-layout-border);
  border-radius: 2px;

  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  height: 32px;

  padding: 0 12px;

  display: flex;
  align-items: center;

  font-weight: var(--font-weight-bold);

  border-bottom: 1px dashed var(--color-list-separator);
`;

const List = styled.div`
  padding: 5px 10px 10px 10px;

  display: flex;
  flex-direction: column;

  &.leaf {
    padding: 5px;
  }

  ${Container}:not(:first-child) {
    margin-top: 5px;
  }
`;

export function HomeScope({
  name,
  leaf,
  children,
}: {
  name: string;
  leaf: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Container>
      <Header>{name}</Header>
      <List className={classNames({leaf})}>{children}</List>
    </Container>
  );
}
