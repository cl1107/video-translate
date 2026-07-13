import React from 'react'
import ReactDom from 'react-dom/client'

import { App } from './App'

import './globals.css'

ReactDom.createRoot(document.querySelector('app') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
