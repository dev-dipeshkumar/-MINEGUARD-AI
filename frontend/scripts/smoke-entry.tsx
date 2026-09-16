/* Render smoke entry: mounts the real App under jsdom against the live API. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'

const el = document.getElementById('root')!
const root = createRoot(el)
root.render(
  <MemoryRouter initialEntries={[(window as any).__SMOKE_PATH__ ?? '/']}>
    <App />
  </MemoryRouter>,
)
;(window as any).__SMOKE_UNMOUNT__ = () => root.unmount()
