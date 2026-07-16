import React from 'react'
import ReactDom from 'react-dom/client'

import { App } from './App'
import { ThemeProvider } from './hooks/use-theme'

import './globals.css'

ReactDom.createRoot(document.querySelector('app') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)
