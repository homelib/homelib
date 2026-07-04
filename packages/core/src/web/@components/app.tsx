import {observer} from 'mobx-react';
import type {ReactElement} from 'react';
import React from 'react';
import {Route} from 'routra-react';

import {router} from '../@routes.js';

import {BindDevicesView} from './@views/bind-devices-view.js';
import {HomeView} from './@views/home-view.js';

export const App = observer((): ReactElement => {
  return (
    <>
      <Route view={router.default.$view()} component={HomeView} />
      <Route view={router.bindDevices.$view()} component={BindDevicesView} />
    </>
  );
});
