import type {ReactElement} from 'react';
import React from 'react';
import {Link} from 'routra-react/browser';

import {router} from '../../@routes.js';

export function HomeView(): ReactElement {
  return (
    <main>
      <h1>Hello, Homelib!</h1>
      <p>
        <Link route={router.bindDevices}>Bind devices →</Link>
      </p>
    </main>
  );
}
