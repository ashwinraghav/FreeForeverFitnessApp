import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@freeforever/design-system/tokens.css';
import '@freeforever/design-system/styles.css';
import './shell/shell.css';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
