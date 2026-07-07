import {observer} from 'mobx-react';
import type {ReactElement} from 'react';
import React from 'react';
import {Route} from 'routra-react';
import {Link} from 'routra-react/browser';
import styled from 'styled-components';

import {router} from '../@routes.js';

import {DevicesView} from './@views/devices/index.js';
import {HomeView} from './@views/home/index.js';
import {GlobalStyle} from './global-style.js';

const NavBar = styled.div`
  display: flex;
  height: 50px;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-layout-border);

  background: radial-gradient(ellipse at left top, #ffffff 0%, #fff8e8 100%);
`;

const Logo = styled(Link)`
  display: flex;
  height: 100%;
  padding: 0 12px;

  align-items: center;

  img {
    height: 24px;
    width: auto;
  }
`;

const NavLinks = styled.div`
  display: flex;
  margin-right: 12px;
  height: 100%;
`;

const NavLink = styled(Link)`
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 16px;

  &::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    height: 2px;
    width: 0;
    background: var(--color-accent);
  }

  &.active {
    font-weight: 600;

    &::after {
      width: 100%;
    }
  }
`;

export const App = observer((): ReactElement => {
  return (
    <>
      <GlobalStyle />
      <NavBar>
        <Logo route={router.default}>
          <img src="homelib-text-light.svg" alt="HomeLib Logo" />
        </Logo>
        <NavLinks>
          <NavLink route={router.default}>Home</NavLink>
          <NavLink route={router.devices}>Devices</NavLink>
        </NavLinks>
      </NavBar>
      <Route view={router.default.$view()} component={HomeView} />
      <Route view={router.devices.$view()} component={DevicesView} />
    </>
  );
});
