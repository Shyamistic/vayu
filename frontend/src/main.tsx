import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Cesium from 'cesium';
import App from './App';
import './index.css';

// Configure CesiumJS ion token
// Replace with your token from ion.cesium.com (free tier: 25k tile loads/month)
Cesium.Ion.defaultAccessToken =
  import.meta.env.VITE_CESIUM_ION_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your_token_here';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
