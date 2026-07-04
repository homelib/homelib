import React from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './@components/index.js';

createRoot(document.getElementById('app')!).render(<App />);
