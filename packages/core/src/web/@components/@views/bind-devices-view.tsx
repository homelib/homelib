import type {ReactElement} from 'react';
import React from 'react';
import {Link} from 'routra-react/browser';

import {router} from '../../@routes.js';

export function BindDevicesView(): ReactElement {
  return (
    <main>
      <h1>Bind Devices</h1>
      <p>Device binding will be implemented here.</p>
      <p>
        <Link route={router.default}>← Back to home</Link>
      </p>
    </main>
  );
}
