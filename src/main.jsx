import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// On n'importe pas de CSS ici pour éviter les conflits, tout est dans App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)