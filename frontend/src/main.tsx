import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import './index.css'
import App from './App.tsx'

// ============================================================
// Auth0Provider — envolve TODO o app e liga o painel ao Auth0.
// - domain / clientId / audience vêm do .env.local (VITE_*).
// - redirect_uri: pra onde o Auth0 volta depois do login (a raiz do painel).
// - audience: diz "quero um token pra ESTA API" (a do backend). Sem isso o
//   Auth0 devolveria um token opaco; com isso vem um JWT que o server valida.
// - cacheLocation 'localstorage' + useRefreshTokens: mantêm a sessão viva
//   entre recarregamentos sem depender de cookies de terceiros (que o Chrome
//   bloqueia). Sem isso o usuário cairia deslogado a cada F5.
// ============================================================
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      cacheLocation="localstorage"
      useRefreshTokens={true}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
)
