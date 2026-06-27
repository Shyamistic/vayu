import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Cesium from 'cesium';
import App from './App';
import './index.css';

// Configure CesiumJS ion token
// Get your FREE token at https://ion.cesium.com/tokens
// Without a valid token, terrain and imagery won't load (you'll only see stars).
const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (!cesiumToken || cesiumToken.includes('your_token_here')) {
  console.warn(
    '⚠️ VAYU: No valid VITE_CESIUM_ION_TOKEN set in .env!\n' +
    'Get a free token at https://ion.cesium.com/tokens and add it to frontend/.env\n' +
    'The globe will show stars but no Earth until this is fixed.'
  );
}
Cesium.Ion.defaultAccessToken = cesiumToken || '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);
