import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App(): React.JSX.Element {
  return (
    <main className="shell">
      <div className="brand-mark" aria-hidden="true">P</div>
      <p className="eyebrow">PHOTOBOOTH STUDIO</p>
      <h1>Your booth,<br /><span>ready when you are.</span></h1>
      <p className="description">Your photo booth workspace is ready to set up.</p>
      <button className="start-button" type="button" disabled>Start a session <span aria-hidden="true">→</span></button>
      <p className="status"><span className="status-dot" /> Booth is ready</p>
      <footer>OFFLINE-READY · PRIVATE BY DESIGN</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
