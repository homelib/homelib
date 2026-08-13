import styled from 'styled-components';

export const FitContainer = styled.div`
  flex: 1;

  display: flex;
`;

export const Column = styled.div`
  height: 100%;

  display: flex;
  flex-direction: column;

  &:not(:last-child) {
    border-right: 1px solid var(--color-layout-border);
  }
`;
