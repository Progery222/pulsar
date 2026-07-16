import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RecorderControlBar from './recorder/RecorderControlBar';
import './index.css';

// Отдельное окно плавающего контрола записи (always-on-top) переиспользует наш bundle
// через ?win=recControl — показываем только панель управления, без остального UI.
const winParam = new URLSearchParams(location.search).get('win');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {winParam === 'recControl' ? <RecorderControlBar /> : <App />}
  </React.StrictMode>
);
