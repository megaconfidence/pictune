/**
 * Pictune Worker
 *
 * Async prediction lifecycle — the Worker never blocks waiting for Replicate.
 * The client drives the loop, which lets long-running upscales (10+ minutes)
 * survive transient network blips and tab backgrounding far better than a
 * single long-open HTTP request.
 *
 *   POST   /api/remove-background       multipart/form-data { image: File }
 *   POST   /api/upscale                  multipart/form-data { image, scale_factor, mode }
 *   POST   /api/expand                   multipart/form-data { image, aspect_ratio }
 *      → 202 { id, status }               (prediction created at Replicate)
 *      → 429 { error } when the caller's IP has hit the per-hour quota
 *
 *   GET    /api/predictions/:id          → JSON { status, output?, error? }
 *      where output (when present) is a Worker-proxied URL — the Replicate URL
 *      itself is never exposed to the browser.
 *
 *   GET    /api/predictions/:id/output   → image/png bytes (streamed)
 *
 *   POST   /api/predictions/:id/cancel   → 204 (idempotent — safe to call after
 *                                              the prediction has finished)
 *
 *   GET    /api/admin/stats              → JSON AdminStats — usage dashboard
 *                                              payload. Gated by the
 *                                              X-Admin-Passphrase header against
 *                                              env.ADMIN_PASSPHRASE.
 *
 * The three POST endpoints (and only those) are double-gated:
 *
 *   1. Cloudflare Turnstile — the client attaches a fresh, single-use token
 *      via the `cf-turnstile-response` header. The Worker calls siteverify
 *      to confirm the visitor is human before any Replicate work happens. A
 *      missing/invalid token returns 403 (logged as bot_blocked).
 *   2. Per-IP rate limit — the RateLimiter Durable Object caps each caller
 *      at 100 transformations / hour. See src/rate-limiter.ts.
 *
 * Polling, output, and cancel are deliberately unrated and not Turnstile-
 * protected: they cost us no Replicate credits and a single transformation
 * can produce many of them. We don't want a long-running poll loop to die
 * because the token aged out.
 *
 * Every gated transformation is also logged (fire-and-forget via waitUntil)
 * to the Analytics Durable Object — see src/analytics.ts — so the admin page
 * can show usage trends without us having to wire up Analytics Engine.
 *
 * Replicate model endpoints used:
 *   POST  /v1/models/{owner}/{name}/predictions
 *   GET   /v1/predictions/{id}
 *   POST  /v1/predictions/{id}/cancel
 */

import { Analytics, type Outcome, type Tool } from './analytics';
import { RateLimiter, type RateLimitResult } from './rate-limiter';

// Re-export so the wrangler durable_objects bindings can find the classes on
// the Worker's main module. The DO runtime imports them from here.
export { Analytics, RateLimiter };

const REPLICATE_API = 'https://api.replicate.com/v1';

const BACKGROUND_MODEL = 'bria/remove-background';
const UPSCALE_MODEL = 'philz1337x/clarity-pro-upscaler';
const EXPAND_MODEL = 'bria/expand-image';

/** Allowed values for the Upscale tool — kept in sync with the React client. */
const ALLOWED_SCALE_FACTORS = new Set([2, 4]);

/**
 * Aspect ratios bria/expand-image accepts. The model rejects everything else
 * (including the "custom float" the API docs mention — we tested it), so we
 * lock the server to this set and let the client snap user inputs to the
 * nearest entry before submitting.
 */
const ALLOWED_ASPECT_RATIOS = new Set([
	'1:1',
	'16:9',
	'9:16',
	'3:2',
	'2:3',
	'4:3',
	'3:4',
	'4:5',
	'5:4',
]);

/**
 * Hostnames we'll proxy image bytes from. Replicate serves model outputs from
 * subdomains of replicate.delivery (e.g. pbxt.replicate.delivery, tjzk.…), so
 * we restrict the proxy to that family to prevent the prediction-output route
 * from being abused as an open proxy.
 */
const ALLOWED_OUTPUT_HOSTS = /(^|\.)replicate\.delivery$/;

/**
 * Map the UI's "Fast Upscale" / "Quality Upscale" dropdown to clarity-pro's
 * creativity dial. Negative values stay strict to the source, positive ones
 * let the model add detail, so Quality goes higher.
 */
function creativityFor(mode: string): number {
	return mode === 'quality' ? 4 : 0;
}

/**
 * Encode a File as a `data:image/...;base64,...` URI so Replicate can ingest
 * it without us needing a public URL. We chunk the byte conversion because
 * passing a giant Uint8Array directly to `String.fromCharCode(...)` blows the
 * argument stack on bigger images.
 */
async function fileToDataUri(file: File): Promise<string> {
	const buffer = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < buffer.length; i += chunkSize) {
		binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
	}
	const base64 = btoa(binary);
	const type = file.type || 'image/png';
	return `data:${type};base64,${base64}`;
}

type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

interface ReplicatePrediction {
	id: string;
	status: PredictionStatus;
	output: string | string[] | null;
	error: string | null;
}

/**
 * Create a prediction at Replicate. Returns immediately — we don't pass
 * `Prefer: wait` because the client owns the poll loop now.
 */
async function startPrediction(
	env: Env,
	model: string,
	input: Record<string, unknown>,
): Promise<ReplicatePrediction> {
	const res = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ input }),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Replicate ${res.status}: ${text.slice(0, 400)}`);
	}

	return (await res.json()) as ReplicatePrediction;
}

/** GET the current state of a prediction. */
async function getPrediction(env: Env, id: string): Promise<ReplicatePrediction> {
	const res = await fetch(`${REPLICATE_API}/predictions/${encodeURIComponent(id)}`, {
		headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
	});

	if (res.status === 404) {
		throw new HttpError(404, 'Prediction not found');
	}
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Replicate ${res.status}: ${text.slice(0, 400)}`);
	}

	return (await res.json()) as ReplicatePrediction;
}

/**
 * Ask Replicate to cancel a running prediction. Best-effort — already-finished
 * predictions return success, so this is safe to call from a client abort
 * handler without first checking status.
 */
async function cancelPrediction(env: Env, id: string): Promise<void> {
	await fetch(`${REPLICATE_API}/predictions/${encodeURIComponent(id)}/cancel`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
	});
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Turnstile                                                                 *
 * ──────────────────────────────────────────────────────────────────────── */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare's "always-pass" test secret. Pairs with the matching test
 * sitekey in src/turnstile.tsx so `wrangler dev` works out of the box
 * without the operator having to add `localhost` to the real widget's
 * allowed hostnames. Production hostnames fall through to the real
 * env.TURNSTILE_SECRET_KEY. See:
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
const DEV_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Shape of the Cloudflare siteverify response we actually read. */
interface SiteverifyResponse {
	success: boolean;
	'error-codes'?: string[];
}

/**
 * Pick the right Turnstile secret for the incoming request. We look at the
 * Host header rather than relying on a build-time flag, because a single
 * compiled Worker bundle can be used by both `wrangler dev` (host =
 * localhost:5173) and a real deployment (host = the configured domain). In
 * production, `localhost` can't appear in the Host header — Cloudflare's
 * edge routes by hostname and would never deliver such a request to us.
 */
function turnstileSecretFor(request: Request, env: Env): string {
	const host = request.headers.get('host') ?? '';
	if (
		host.startsWith('localhost') ||
		host.startsWith('127.0.0.1') ||
		host.startsWith('[::1]')
	) {
		return DEV_TEST_SECRET;
	}
	return env.TURNSTILE_SECRET_KEY;
}

/**
 * Validate a Turnstile token against Cloudflare's siteverify endpoint.
 *
 *   - Returns true on `{ success: true }`.
 *   - Returns false for invalid / replayed / expired tokens. We log the
 *     error-codes from Cloudflare so the operator can tell why later.
 *   - On a siteverify HTTP failure (Cloudflare unavailable) we fail CLOSED:
 *     the rate limiter fails open because that's a tiny convenience win,
 *     but Turnstile is our bot deterrent — failing open would void it.
 *
 * We don't include `remoteip` in the request: siteverify uses it to bind
 * a token to the originating IP and reject re-use from a different IP,
 * but the IP we have here (`cf-connecting-ip`) is the same one Cloudflare
 * already saw when issuing the token. Sending it is redundant for our
 * deployment topology, and the extra field is one more thing to get wrong
 * when behind a proxy or in dev.
 */
async function verifyTurnstile(token: string, request: Request, env: Env): Promise<boolean> {
	const body = new URLSearchParams({
		secret: turnstileSecretFor(request, env),
		response: token,
	});
	let res: Response;
	try {
		res = await fetch(TURNSTILE_VERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
	} catch (err) {
		console.error('Turnstile siteverify network error:', err);
		return false;
	}
	if (!res.ok) {
		console.error('Turnstile siteverify HTTP error:', res.status);
		return false;
	}
	const data = (await res.json()) as SiteverifyResponse;
	if (!data.success) {
		console.warn('Turnstile rejected token:', data['error-codes']);
	}
	return data.success === true;
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Rate limiting                                                             *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Consume one quota slot for the caller's IP. Fails open if the DO call
 * blows up — a flaky rate limiter shouldn't be allowed to take down the
 * whole API. The "remaining" we report in the fail-open case is the upper
 * bound (the limit) so the X-RateLimit-Remaining header still looks sane.
 */
async function checkRateLimit(request: Request, env: Env): Promise<RateLimitResult> {
	// cf-connecting-ip is set by Cloudflare's edge on every real request.
	// `wrangler dev` populates it from the local socket. Falls back to
	// "unknown" if absent — all anonymous callers share one bucket then,
	// which is an acceptable degradation rather than a wide-open door.
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	try {
		const stub = env.RATE_LIMITER.getByName(ip);
		return await stub.consume();
	} catch (err) {
		console.error('Rate limit check failed, failing open:', err);
		return { allowed: true, remaining: 100, limit: 100, retryAfter: 0 };
	}
}

/** Headers to attach to every transformation response so the client can self-pace. */
function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
	return {
		'X-RateLimit-Limit': String(result.limit),
		'X-RateLimit-Remaining': String(result.remaining),
	};
}

/** 429 response when the caller has exhausted their quota. */
function rateLimit429(result: RateLimitResult): Response {
	return Response.json(
		{
			error: `You've used all ${result.limit} transformations in the past hour. Try again in ${formatRetryAfter(result.retryAfter)}.`,
		},
		{
			status: 429,
			headers: {
				...rateLimitHeaders(result),
				'Retry-After': String(result.retryAfter),
				'Cache-Control': 'no-store',
			},
		},
	);
}

/**
 * Human-friendly rendering of a Retry-After value (in seconds). The text is
 * just a friendly summary — the precise number still rides in the
 * `Retry-After` header for any automation that wants it. We round up at
 * minute boundaries so the user doesn't retry a hair too early and bounce
 * off a 429 again.
 *
 *    ≤ 10s    → "a moment"
 *   11–59s    → "32 seconds"
 *   60–89s    → "about a minute"
 *   90s–59m   → "about N minutes"
 *      60m+   → "about an hour"   (the max, since our window is 1h)
 */
function formatRetryAfter(seconds: number): string {
	if (seconds <= 10) return 'a moment';
	if (seconds < 60) return `${seconds} seconds`;
	if (seconds < 90) return 'about a minute';
	const minutes = Math.ceil(seconds / 60);
	if (minutes >= 60) return 'about an hour';
	return `about ${minutes} minutes`;
}

/**
 * Wrap a transformation handler with Turnstile verification, the per-IP rate
 * check, and analytics logging. The handler is only called if both gates
 * pass; the resulting `RateLimitResult` is threaded through so the handler
 * can include rate-limit headers on its 2xx response.
 *
 * Gate order is Turnstile → rate limit → handler. Turnstile runs first
 * because the whole point of the bot deterrent is to reject obvious junk
 * before it touches anything we care about — including the rate limiter
 * (each siteverify call is cheap, but a bot flood shouldn't burn DO ops).
 *
 * Each call records exactly one analytics event:
 *   - bot_blocked  Turnstile rejected (or no token supplied).
 *   - rate_limited Turnstile passed but the per-IP quota is exhausted.
 *   - accepted     Both gates passed and the handler returned normally.
 *   - failed       Both gates passed but the handler threw (Replicate 5xx,
 *                  malformed multipart, image upload too big, …). The error
 *                  still propagates to the outer try/catch in fetch(); we
 *                  just take a moment to record it on the way up.
 *
 * Logging is fire-and-forget via ctx.waitUntil so it never adds latency to
 * the user's response.
 */
async function gateTransformation(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	tool: Tool,
	handler: (req: Request, env: Env, limit: RateLimitResult) => Promise<Response>,
): Promise<Response> {
	const token = request.headers.get('cf-turnstile-response');
	if (!token || !(await verifyTurnstile(token, request, env))) {
		ctx.waitUntil(logEvent(env, request, tool, 'bot_blocked'));
		return jsonError(
			'Verification failed. Reload the page and try again.',
			403,
		);
	}

	const limit = await checkRateLimit(request, env);
	if (!limit.allowed) {
		ctx.waitUntil(logEvent(env, request, tool, 'rate_limited'));
		return rateLimit429(limit);
	}
	try {
		const res = await handler(request, env, limit);
		ctx.waitUntil(logEvent(env, request, tool, 'accepted'));
		return res;
	} catch (err) {
		ctx.waitUntil(logEvent(env, request, tool, 'failed'));
		throw err;
	}
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Analytics                                                                 *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Append one event to the Analytics DO. Best-effort — a logging failure
 * must not surface to the user, so we swallow any errors with a console
 * note. The country comes from the Cloudflare-injected request.cf object;
 * in `wrangler dev` this may be absent.
 */
async function logEvent(
	env: Env,
	request: Request,
	tool: Tool,
	outcome: Outcome,
): Promise<void> {
	try {
		const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
		const cfCountry = (request.cf as { country?: string } | undefined)?.country;
		const stub = env.ANALYTICS.getByName('global');
		await stub.log({
			ts: Date.now(),
			ip,
			country: typeof cfCountry === 'string' ? cfCountry : null,
			tool,
			outcome,
		});
	} catch (err) {
		console.error('Analytics log failed:', err);
	}
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Admin                                                                     *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/admin/stats — return the dashboard payload, gated by a single
 * shared passphrase delivered in the `X-Admin-Passphrase` request header.
 *
 * The 401 path waits a fixed 500ms before responding. That's enough to make
 * a brute-force attempt impractical (one attempt every half-second versus
 * a 24-character random passphrase = effectively impossible) without
 * annoying the legitimate admin, who only types it in once per session.
 */
async function handleAdminStats(request: Request, env: Env): Promise<Response> {
	const supplied = request.headers.get('x-admin-passphrase');
	if (!supplied || !safeStringEqual(supplied, env.ADMIN_PASSPHRASE)) {
		await sleep(500);
		return jsonError('Unauthorized', 401);
	}
	const stub = env.ANALYTICS.getByName('global');
	const stats = await stub.stats();
	return Response.json(stats, {
		headers: { 'Cache-Control': 'no-store' },
	});
}

/**
 * Constant-time string comparison. A naive `===` returns as soon as the
 * first differing character is found, which leaks (in principle) how many
 * leading characters of a guess are correct via response timing. This
 * variant always XORs the full length so the comparison time is independent
 * of how close the guess is.
 */
function safeStringEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Route handlers                                                            *
 * ──────────────────────────────────────────────────────────────────────── */

async function handleRemoveBackground(
	request: Request,
	env: Env,
	limit: RateLimitResult,
): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const prediction = await startPrediction(env, BACKGROUND_MODEL, {
		image: await fileToDataUri(image),
		preserve_alpha: true,
	});
	return predictionJson(prediction, 202, rateLimitHeaders(limit));
}

async function handleUpscale(
	request: Request,
	env: Env,
	limit: RateLimitResult,
): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const scaleRaw = Number(form.get('scale_factor'));
	const scaleFactor = ALLOWED_SCALE_FACTORS.has(scaleRaw) ? scaleRaw : 2;
	const mode = String(form.get('mode') ?? 'fast');

	const prediction = await startPrediction(env, UPSCALE_MODEL, {
		image: await fileToDataUri(image),
		scale_factor: scaleFactor,
		creativity: creativityFor(mode),
		output_format: 'png',
	});
	return predictionJson(prediction, 202, rateLimitHeaders(limit));
}

async function handleExpand(
	request: Request,
	env: Env,
	limit: RateLimitResult,
): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const aspectRatio = String(form.get('aspect_ratio') ?? '');
	if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
		return jsonError(
			`aspect_ratio must be one of ${[...ALLOWED_ASPECT_RATIOS].join(', ')}`,
			400,
		);
	}

	const prediction = await startPrediction(env, EXPAND_MODEL, {
		image: await fileToDataUri(image),
		aspect_ratio: aspectRatio,
		// false → the model fills the expanded area with generated content
		// (the whole point of the tool). true would leave it transparent.
		preserve_alpha: false,
	});
	return predictionJson(prediction, 202, rateLimitHeaders(limit));
}

/** Status endpoint the client polls. */
async function handleGetPrediction(env: Env, id: string): Promise<Response> {
	const prediction = await getPrediction(env, id);
	return predictionJson(prediction, 200);
}

/**
 * Stream the bytes of a finished prediction. Re-queries Replicate (rather
 * than trusting an output URL passed in by the client) so we can validate
 * the host. The two extra subrequests are cheap and the indirection is the
 * whole point of not exposing Replicate URLs.
 */
async function handleGetPredictionOutput(env: Env, id: string): Promise<Response> {
	const prediction = await getPrediction(env, id);

	if (prediction.status !== 'succeeded') {
		return jsonError(`Prediction is ${prediction.status}`, 409);
	}

	const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
	if (typeof outputUrl !== 'string') {
		return jsonError('Prediction has no output URL', 502);
	}

	let parsed: URL;
	try {
		parsed = new URL(outputUrl);
	} catch {
		return jsonError('Invalid output URL', 502);
	}
	if (!ALLOWED_OUTPUT_HOSTS.test(parsed.hostname)) {
		return jsonError(`Refusing to proxy host ${parsed.hostname}`, 502);
	}

	const upstream = await fetch(outputUrl);
	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => '');
		return jsonError(
			`Failed to fetch result image (${upstream.status}): ${text.slice(0, 200)}`,
			502,
		);
	}

	return new Response(upstream.body, {
		headers: {
			'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
			// Once a prediction succeeds the bytes are immutable, so a short
			// cache lifetime is safe and saves a round-trip if the client
			// re-fetches (e.g. switching tools then back).
			'Cache-Control': 'private, max-age=300',
		},
	});
}

async function handleCancelPrediction(env: Env, id: string): Promise<Response> {
	await cancelPrediction(env, id);
	return new Response(null, { status: 204 });
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Response helpers                                                          *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Shape the prediction JSON we send to the client. We deliberately do NOT
 * forward Replicate's `output` field — the client gets a Worker URL it can
 * GET to stream the bytes (see /api/predictions/:id/output).
 *
 * `extraHeaders` lets callers attach rate-limit advisories (X-RateLimit-*)
 * without having to rebuild the response from scratch.
 */
function predictionJson(
	prediction: ReplicatePrediction,
	status: number,
	extraHeaders: Record<string, string> = {},
): Response {
	const body: Record<string, unknown> = {
		id: prediction.id,
		status: prediction.status,
	};
	if (prediction.status === 'succeeded') {
		body.output = `/api/predictions/${encodeURIComponent(prediction.id)}/output`;
	}
	if (prediction.error) {
		body.error = prediction.error;
	}
	return Response.json(body, {
		status,
		headers: { 'Cache-Control': 'no-store', ...extraHeaders },
	});
}

class HttpError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Routing                                                                   *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Pull a `:id` out of a path like `/api/predictions/abc/output`. Returns
 * `null` if the path doesn't match. The id segment is decoded.
 */
function matchPredictionRoute(
	pathname: string,
): { id: string; suffix: 'status' | 'output' | 'cancel' } | null {
	const match = pathname.match(/^\/api\/predictions\/([^/]+)(?:\/(output|cancel))?$/);
	if (!match) return null;
	const id = decodeURIComponent(match[1]);
	const suffix = (match[2] ?? 'status') as 'status' | 'output' | 'cancel';
	return { id, suffix };
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (request.method === 'POST' && url.pathname === '/api/remove-background') {
				return await gateTransformation(
					request,
					env,
					ctx,
					'background',
					handleRemoveBackground,
				);
			}

			if (request.method === 'POST' && url.pathname === '/api/upscale') {
				return await gateTransformation(request, env, ctx, 'upscale', handleUpscale);
			}

			if (request.method === 'POST' && url.pathname === '/api/expand') {
				return await gateTransformation(request, env, ctx, 'expand', handleExpand);
			}

			if (request.method === 'GET' && url.pathname === '/api/admin/stats') {
				return await handleAdminStats(request, env);
			}

			const prediction = matchPredictionRoute(url.pathname);
			if (prediction) {
				const { id, suffix } = prediction;
				if (request.method === 'GET' && suffix === 'status') {
					return await handleGetPrediction(env, id);
				}
				if (request.method === 'GET' && suffix === 'output') {
					return await handleGetPredictionOutput(env, id);
				}
				if (request.method === 'POST' && suffix === 'cancel') {
					return await handleCancelPrediction(env, id);
				}
				return jsonError('Method not allowed', 405);
			}

			return jsonError('Not found', 404);
		} catch (err) {
			if (err instanceof HttpError) return jsonError(err.message, err.status);
			const msg = err instanceof Error ? err.message : String(err);
			return jsonError(msg, 502);
		}
	},
} satisfies ExportedHandler<Env>;
