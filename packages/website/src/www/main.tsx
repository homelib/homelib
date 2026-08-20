import React from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './app.js';

createRoot(document.getElementById('app')!).render(<App />);
