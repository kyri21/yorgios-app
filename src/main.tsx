import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Enregistrement du Service Worker PWA (géré par vite-plugin-pwa)
import { registerSW } from 'virtual:pwa-register';
registerSW({
  immediate: true,
  onNeedRefresh() {
    // Bannière "Nouvelle version disponible" — ne recharge pas automatiquement
    // pour ne pas perdre une saisie en cours
    const bar = document.createElement('div')
    bar.id = 'pwa-update-bar'
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#004275', 'color:#fff',
      'padding:11px 16px',
      'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:12px',
      'font-family:Manrope,sans-serif', 'font-size:13px', 'font-weight:600',
      'box-shadow:0 2px 12px rgba(0,0,0,0.18)',
    ].join(';')
    bar.innerHTML = `
      <span>Nouvelle version disponible 🆕</span>
      <button
        onclick="window.location.reload()"
        style="background:#fff;color:#004275;border:none;padding:7px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-family:Manrope,sans-serif;font-size:13px;white-space:nowrap"
      >Actualiser ↺</button>
    `
    document.body.appendChild(bar)
  },
  onOfflineReady() {},
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
