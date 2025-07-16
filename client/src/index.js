import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // doit contenir les directives Tailwind
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
