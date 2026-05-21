import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './admin';
import App from './app';
import { TurnstileProvider } from './turnstile';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

// Tiny pathname-based router. The two surfaces don't share any state, so
// there's no point pulling in react-router for a binary switch. The Worker's
// SPA fallback (run_worker_first: ["/api/*"]) serves index.html for /admin
// too, and we pick the right component here.
//
// TurnstileProvider only wraps the editor surface — the admin page is gated
// by a passphrase and never calls the rate-limited POST endpoints, so it
// doesn't need a widget. Skipping it also avoids loading the Turnstile
// script on a page that doesn't use it.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(root).render(
	<StrictMode>
		{isAdmin ? (
			<AdminApp />
		) : (
			<TurnstileProvider>
				<App />
			</TurnstileProvider>
		)}
	</StrictMode>,
);
