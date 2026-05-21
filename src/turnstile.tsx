/**
 * Cloudflare Turnstile integration.
 *
 * Renders a single Non-Interactive widget pinned to the bottom-left of the
 * editor and exposes a `getToken()` helper to the rest of the app via the
 * `useTurnstile` hook. Each transformation Run (background / upscale /
 * expand) awaits a token, attaches it to the API request, and resets the
 * widget so a fresh challenge is in flight by the time the user clicks again.
 *
 * Why a single shared widget instead of one per panel?
 *
 *   - Rendering three widgets means three concurrent challenges running
 *     even when the user has only one tool open.
 *   - The user only ever runs one tool at a time, so we never need two
 *     tokens in flight.
 *
 * The script tag itself lives in index.html with `async defer` so it
 * doesn't block the SPA render. We wait for `window.turnstile` to appear
 * before calling `render()`. On a fresh page load that wait is ~50–300ms
 * over a warm cache, but we cap it at 10s to fail visibly on flaky
 * networks rather than hanging the first Run forever.
 *
 * Token lifecycle:
 *
 *   1. Widget mounts, runs its challenge, and calls our `callback` with
 *      a fresh token. We stash it in tokenRef.
 *   2. The user clicks Run. `getToken()` consumes tokenRef and immediately
 *      calls `turnstile.reset()` so the widget starts working on the NEXT
 *      token in parallel with our Replicate request.
 *   3. If the user clicks Run before tokenRef has a value (very fast double-
 *      click after page load), we register a waiter and resolve as soon as
 *      the callback fires.
 *   4. If the token expires (default lifetime: ~5 minutes) without being
 *      used, Turnstile auto-refreshes thanks to `refresh-expired: 'auto'`.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react';

/* ──────────────────────────────────────────────────────────────────────── *
 * Public API                                                                *
 * ──────────────────────────────────────────────────────────────────────── */

interface TurnstileContextValue {
	/**
	 * Resolve to a fresh, single-use Turnstile token. The widget is reset
	 * as soon as the token is handed out, so the next call gets a different
	 * one and an in-flight challenge starts immediately for the call after.
	 *
	 * Rejects if the widget hasn't issued a token within `WAIT_TIMEOUT_MS`
	 * (usually means the script failed to load — ad-blocker, captive
	 * portal, or a real outage).
	 */
	getToken: () => Promise<string>;
	/** True once the widget has rendered and the script is loaded. */
	ready: boolean;
}

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

export function useTurnstile(): TurnstileContextValue {
	const ctx = useContext(TurnstileContext);
	if (!ctx) throw new Error('useTurnstile must be used inside TurnstileProvider');
	return ctx;
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Provider                                                                  *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Cloudflare's "always-pass, any-domain" test sitekey, documented at
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/.
 * Saves the operator from having to add `localhost` to the production
 * widget's allowed hostnames every time they spin up `wrangler dev`.
 * The matching test secret is hard-wired into server.ts.
 */
const DEV_TEST_SITE_KEY = '1x00000000000000000000AA';

const SITE_KEY: string | undefined = import.meta.env.DEV
	? DEV_TEST_SITE_KEY
	: (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined);

/** How long to wait for `window.turnstile` to appear after mount. */
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
/** How long getToken() will block waiting for the widget to issue a token. */
const WAIT_TIMEOUT_MS = 15_000;
/** Poll interval while waiting for the script. */
const POLL_MS = 50;

type TokenWaiter = (token: string) => void;

interface TurnstileRenderParams {
	sitekey: string;
	callback: (token: string) => void;
	'error-callback'?: (error: string) => void;
	'expired-callback'?: () => void;
	'timeout-callback'?: () => void;
	'refresh-expired'?: 'auto' | 'manual' | 'never';
	appearance?: 'always' | 'execute' | 'interaction-only';
	size?: 'normal' | 'flexible' | 'compact';
	theme?: 'light' | 'dark' | 'auto';
}

interface TurnstileGlobal {
	render: (container: HTMLElement | string, params: TurnstileRenderParams) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId: string) => void;
	getResponse: (widgetId?: string) => string | undefined;
}

declare global {
	interface Window {
		turnstile?: TurnstileGlobal;
	}
}

/** Wait for the Turnstile script to install its global, polling every POLL_MS. */
async function waitForTurnstileScript(): Promise<TurnstileGlobal> {
	const deadline = Date.now() + SCRIPT_LOAD_TIMEOUT_MS;
	while (!window.turnstile) {
		if (Date.now() > deadline) {
			throw new Error('Turnstile script failed to load');
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	return window.turnstile;
}

export function TurnstileProvider({ children }: { children: ReactNode }) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const widgetIdRef = useRef<string | null>(null);
	const tokenRef = useRef<string | null>(null);
	const waitersRef = useRef<TokenWaiter[]>([]);
	const [ready, setReady] = useState(false);

	/**
	 * Called by Turnstile every time it has a fresh token for us. If callers
	 * are already waiting (race: user clicked Run before the first challenge
	 * resolved), hand the token straight to them; otherwise cache it for
	 * the next getToken() call.
	 */
	const onToken = useCallback((token: string) => {
		if (waitersRef.current.length > 0) {
			const next = waitersRef.current.shift()!;
			next(token);
		} else {
			tokenRef.current = token;
		}
	}, []);

	const onInvalid = useCallback(() => {
		// Token expired or errored before being used. Clear the cache; the
		// widget's refresh-expired:auto will produce a new one shortly.
		tokenRef.current = null;
	}, []);

	// Render the widget on mount, remove it on unmount. The cleanup is what
	// makes this safe under React.StrictMode (which mounts effects twice
	// in dev): without `turnstile.remove()` we'd accumulate widgets each
	// reload.
	useEffect(() => {
		if (!SITE_KEY) {
			console.warn(
				'TurnstileProvider: VITE_TURNSTILE_SITE_KEY is not set. Verification will not be available.',
			);
			return;
		}
		const container = containerRef.current;
		if (!container) return;

		let cancelled = false;
		let id: string | null = null;

		waitForTurnstileScript()
			.then((api) => {
				if (cancelled) return;
				id = api.render(container, {
					sitekey: SITE_KEY,
					callback: onToken,
					'error-callback': onInvalid,
					'expired-callback': onInvalid,
					'timeout-callback': onInvalid,
					'refresh-expired': 'auto',
					appearance: 'always',
					size: 'flexible',
					theme: 'light',
				});
				widgetIdRef.current = id;
				setReady(true);
			})
			.catch((err: unknown) => {
				console.error('Turnstile init failed:', err);
			});

		return () => {
			cancelled = true;
			if (id && window.turnstile) {
				try {
					window.turnstile.remove(id);
				} catch (err) {
					// remove() throws if the widget id is unknown (already
					// removed). Harmless under StrictMode where this can
					// run twice in quick succession.
					console.warn('Turnstile remove() failed:', err);
				}
			}
			widgetIdRef.current = null;
			tokenRef.current = null;
			waitersRef.current = [];
			setReady(false);
		};
	}, [onToken, onInvalid]);

	const getToken = useCallback(async (): Promise<string> => {
		// Fast path: a token is sitting in cache. Consume it and immediately
		// reset the widget so the next challenge is in flight by the time
		// the caller's request returns.
		if (tokenRef.current) {
			const token = tokenRef.current;
			tokenRef.current = null;
			if (widgetIdRef.current && window.turnstile) {
				window.turnstile.reset(widgetIdRef.current);
			}
			return token;
		}

		// Slow path: no cached token. Either the widget hasn't issued its
		// first one yet (most common on initial page load) or we just used
		// it and are still mid-challenge. Queue up and wait.
		return new Promise<string>((resolve, reject) => {
			let settled = false;
			const waiter: TokenWaiter = (token) => {
				if (settled) return;
				settled = true;
				// We're consuming this token; trigger the next challenge.
				if (widgetIdRef.current && window.turnstile) {
					window.turnstile.reset(widgetIdRef.current);
				}
				resolve(token);
			};
			waitersRef.current.push(waiter);

			setTimeout(() => {
				if (settled) return;
				settled = true;
				const idx = waitersRef.current.indexOf(waiter);
				if (idx >= 0) waitersRef.current.splice(idx, 1);
				reject(
					new Error(
						'Verification timed out. Reload the page and try again.',
					),
				);
			}, WAIT_TIMEOUT_MS);
		});
	}, []);

	return (
		<TurnstileContext.Provider value={{ getToken, ready }}>
			{children}
			{/* Fixed bottom-left, mirroring the bottom-right controls. The
			    widget's own card chrome (border + Cloudflare logo) is the
			    visual shell — we don't wrap it in our own .card to avoid
			    double-shell glow. min-width keeps the flexible-size widget
			    from collapsing to 0 inside a zero-width parent on first
			    render. */}
			<div className="pointer-events-auto fixed bottom-5 left-5 z-10 w-[300px]">
				<div ref={containerRef} />
			</div>
		</TurnstileContext.Provider>
	);
}
