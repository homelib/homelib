import {configure} from 'mobx';
import React from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './@components/index.js';

configure({enforceActions: 'observed'});

createRoot(document.getElementById('app')!).render(<App />);
