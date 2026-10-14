import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startSchedulerConsumer } from './services/agent/schedulerConsumer';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Scheduler-Consumer starten: führt geplante Jobs aus, sobald nextRun fällig ist
startSchedulerConsumer();
