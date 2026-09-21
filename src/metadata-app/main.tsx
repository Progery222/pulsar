import React from 'react';
import ReactDOM from 'react-dom/client';
import MetadataApp from '../metadata/MetadataApp';
import Toast from '../components/Toast';
import '../index.css';
import { initAccent } from '../utils/accent';

// Отдельное приложение «Pulsar Метаданные»: тот же экран, что в Pulsar, без остального.
initAccent();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MetadataApp standalone />
    <Toast />
  </React.StrictMode>,
);
