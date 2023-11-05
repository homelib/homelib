import React from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './@components/index.js';

import './@main.css';

const root = document.getElementById('root')!;

createRoot(root).render(<App />);
