import '@fontsource-variable/noto-sans-sc'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './App'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Landing page root element is missing')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
