// HolyOS PWA sklad — vstupní bod Reactu
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { SyncProvider } from './sync/SyncContext';
import './styles/global.css';

// Verze sestavení — změna vynutí nový bundle i service worker (po výpadku 26. 10. si čtečky uložily rozbitou cache)
console.info('HolyOS Sklad build 2026-10-26b');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SyncProvider>
          <App />
        </SyncProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
