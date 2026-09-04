import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { purgeLegacyCache } from './pwa/legacyCache';
import './styles/global.css';
import './styles/app.css';
import './styles/pentathlon.css';
import './styles/practice.css';

void purgeLegacyCache();

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
container.classList.remove('loading-screen');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
