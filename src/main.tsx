import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RecorderControlBar from './recorder/RecorderControlBar';
import RecorderNotes from './recorder/RecorderNotes';
import './index.css';

// Отдельные окна рекордера (always-on-top) переиспользуют наш bundle через ?win=…:
// recControl — панель управления записью, recNotes — окно заметок.
const winParam = new URLSearchParams(location.search).get('win');

function Root() {
  if (winParam === 'recControl') return <RecorderControlBar />;
  if (winParam === 'recNotes') return <RecorderNotes />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
