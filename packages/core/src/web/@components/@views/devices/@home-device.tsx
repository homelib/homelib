import classNames from 'classnames';
import {Link2} from 'lucide-react';
import type {DragEvent, ReactElement, ReactNode} from 'react';
import React, {useCallback, useState} from 'react';
import styled from 'styled-components';

export const Container = styled.div`
  --size: 30px;

  border-radius: 2px;

  position: relative;
  display: flex;
  align-items: center;

  transition: background 0.2s;

  cursor: default;

  &:hover {
    background: var(--color-surface-hover);
  }

  &.selected {
    background: var(--color-surface-highlight);
  }

  &.dragover {
    background: var(--color-surface-highlight);

    &::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;

      pointer-events: none;
      border-radius: 2px;
      border: 1px dashed var(--color-accent);
    }
  }
`;

const IconContainer = styled.div`
  margin-right: -2px;

  width: var(--size);
  height: var(--size);

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-icon-decorative);

  transition: color 0.2s;

  ${Container}:hover & {
    color: var(--color-icon-active);
  }

  ${Container}.selected & {
    color: var(--color-icon-highlight);
  }

  ${Container}.dragover & {
    color: var(--color-icon-highlight);
  }

  > svg {
    width: 14px;
  }
`;

const Name = styled.div`
  flex: 1;

  color: var(--color-text-secondary);

  transition: color 0.2s;

  ${Container}:hover & {
    color: var(--color-text-primary);
  }

  ${Container}.selected & {
    color: var(--color-text-primary);
  }

  ${Container}.dragover & {
    color: var(--color-text-primary);
  }
`;

export function HomeDevice({
  icon,
  bind,
  selected,
  children,
}: {
  icon: ReactNode;
  bind: boolean | number;
  selected: boolean;
  children: ReactNode;
}): ReactElement {
  const [dragover, setDragover] = useState(false);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragover(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }

    setDragover(false);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragover(false);
  }, []);

  return (
    <Container
      className={classNames({dragover, selected})}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <IconContainer>{icon}</IconContainer>
      <Name>{children}</Name>
      <Indicator bind={bind} dragover={dragover} />
    </Container>
  );
}

const IndicatorContainer = styled.div`
  width: var(--size);
  height: var(--size);

  display: flex;
  align-items: center;
  justify-content: center;

  > svg {
    width: 14px;
  }

  &.dragover {
    color: var(--color-icon-highlight);
  }
`;

const BadgeIndicator = styled.div`
  width: 14px;
  height: 14px;
  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 11px;

  background: var(--color-icon-decorative);
  color: var(--color-on-accent);

  transition: background 0.2s;

  ${IndicatorContainer}.bind & {
    background: var(--color-icon-highlight);
  }
`;

const DotIndicator = styled.div`
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: var(--color-icon-decorative);

  transition: background 0.2s;

  ${IndicatorContainer}.bind & {
    background: var(--color-icon-highlight);
  }
`;

function Indicator({
  bind,
  dragover,
}: {
  bind: boolean | number;
  dragover: boolean;
}): ReactElement {
  if (dragover) {
    return (
      <IndicatorContainer className="dragover">
        <Link2 />
      </IndicatorContainer>
    );
  }

  if (typeof bind === 'number') {
    return (
      <IndicatorContainer className={classNames({bind: bind > 0})}>
        <BadgeIndicator>{bind}</BadgeIndicator>
      </IndicatorContainer>
    );
  } else {
    return (
      <IndicatorContainer className={classNames({bind})}>
        <DotIndicator />
      </IndicatorContainer>
    );
  }
}
