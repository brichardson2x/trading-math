import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Bootstrap CSS (added to improve default styling)
import 'bootstrap/dist/css/bootstrap.min.css'
import MonteCarloTrading from './monte_carlo_trading'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MonteCarloTrading />
  </StrictMode>
)
