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
 * Replicate model endpoints used:
 *   POST  /v1/models/{owner}/{name}/predictions
 *   GET   /v1/predictions/{id}
 *   POST  /v1/predictions/{id}/cancel
 */

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
 * Route handlers                                                            *
 * ──────────────────────────────────────────────────────────────────────── */

async function handleRemoveBackground(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const prediction = await startPrediction(env, BACKGROUND_MODEL, {
		image: await fileToDataUri(image),
		preserve_alpha: true,
	});
	return predictionJson(prediction, 202);
}

async function handleUpscale(request: Request, env: Env): Promise<Response> {
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
	return predictionJson(prediction, 202);
}

async function handleExpand(request: Request, env: Env): Promise<Response> {
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
	return predictionJson(prediction, 202);
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
 */
function predictionJson(prediction: ReplicatePrediction, status: number): Response {
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
		headers: { 'Cache-Control': 'no-store' },
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
	async fetch(request, env, _ctx): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (request.method === 'POST' && url.pathname === '/api/remove-background') {
				return await handleRemoveBackground(request, env);
			}

			if (request.method === 'POST' && url.pathname === '/api/upscale') {
				return await handleUpscale(request, env);
			}

			if (request.method === 'POST' && url.pathname === '/api/expand') {
				return await handleExpand(request, env);
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
