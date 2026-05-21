/**
 * Pictune Worker
 *
 * Two endpoints, both proxying to Replicate:
 *
 *   POST /api/remove-background  multipart/form-data { image: File }
 *   POST /api/upscale            multipart/form-data { image: File, scale_factor: 2|4, mode: fast|quality }
 *
 * Both return the processed PNG bytes directly so the browser never sees the
 * Replicate URL (which expires after 1 hour) or the API token.
 *
 * Replicate's official model endpoint format:
 *   https://api.replicate.com/v1/models/{owner}/{name}/predictions
 *
 * Sending `Prefer: wait` makes the request block until the prediction
 * completes (up to 60s) so we don't need a polling loop.
 */

const REPLICATE_API = 'https://api.replicate.com/v1';

const BACKGROUND_MODEL = 'bria/remove-background';
const UPSCALE_MODEL = 'philz1337x/clarity-pro-upscaler';

/** Allowed values for the Upscale tool — kept in sync with the React client. */
const ALLOWED_SCALE_FACTORS = new Set([2, 4]);

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

interface ReplicatePrediction {
	id: string;
	status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
	output: string | string[] | null;
	error: string | null;
}

/**
 * Call a Replicate model synchronously. Returns the first output URL.
 *
 * Notes:
 *   - We use `Prefer: wait=55` so the request completes within the Workers
 *     30s soft request limit on the free plan as long as the model is fast.
 *     For longer jobs we fall back to a couple of polls below.
 *   - If the prediction hasn't finished within the wait window, we poll up to
 *     5 more times with a 5s interval (max ~25s of additional wait). Total
 *     end-to-end ceiling: ~80s. Most calls return in 5–20s.
 */
async function runReplicate(
	env: Env,
	model: string,
	input: Record<string, unknown>,
): Promise<string> {
	const startRes = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			'Content-Type': 'application/json',
			// Wait up to 55 seconds inside Replicate before returning. If the
			// prediction is still running, the response is a non-terminal
			// prediction and we poll below.
			Prefer: 'wait=55',
		},
		body: JSON.stringify({ input }),
	});

	if (!startRes.ok) {
		const text = await startRes.text();
		throw new Error(`Replicate ${startRes.status}: ${text.slice(0, 400)}`);
	}

	let prediction = (await startRes.json()) as ReplicatePrediction;

	// Poll if Replicate handed us back a still-running prediction.
	let polls = 0;
	while (
		(prediction.status === 'starting' || prediction.status === 'processing') &&
		polls < 5
	) {
		await new Promise((r) => setTimeout(r, 5000));
		const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
			headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
		});
		if (!pollRes.ok) {
			throw new Error(`Replicate poll ${pollRes.status}`);
		}
		prediction = (await pollRes.json()) as ReplicatePrediction;
		polls += 1;
	}

	if (prediction.status !== 'succeeded') {
		const detail = prediction.error ?? `status=${prediction.status}`;
		throw new Error(`Replicate prediction did not succeed: ${detail}`);
	}

	const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
	if (!url) throw new Error('Replicate prediction returned no output URL');
	return url;
}

/**
 * Fetch the model output URL and stream the bytes back to the caller. We pass
 * the response body through unchanged so the Worker never buffers the full
 * image in memory.
 */
async function proxyImageResponse(url: string): Promise<Response> {
	const upstream = await fetch(url);
	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => '');
		throw new Error(`Failed to fetch result image (${upstream.status}): ${text.slice(0, 200)}`);
	}
	return new Response(upstream.body, {
		headers: {
			'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
			// Per-user, never-cached: each user's image is unique and short-
			// lived. Avoids stale entries in any intermediate caches.
			'Cache-Control': 'private, no-store',
		},
	});
}

/** Tiny JSON error helper so every failure path looks the same to the client. */
function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status });
}

async function handleRemoveBackground(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const dataUri = await fileToDataUri(image);
	const url = await runReplicate(env, BACKGROUND_MODEL, {
		image: dataUri,
		// V2 of the API. Keep alpha so we get the transparent PNG the UI
		// composites onto the checkerboard.
		preserve_alpha: true,
	});
	return proxyImageResponse(url);
}

async function handleUpscale(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();
	const image = form.get('image');
	if (!(image instanceof File)) return jsonError('image required', 400);

	const scaleRaw = Number(form.get('scale_factor'));
	const scaleFactor = ALLOWED_SCALE_FACTORS.has(scaleRaw) ? scaleRaw : 2;
	const mode = String(form.get('mode') ?? 'fast');

	const url = await runReplicate(env, UPSCALE_MODEL, {
		image: await fileToDataUri(image),
		scale_factor: scaleFactor,
		creativity: creativityFor(mode),
		output_format: 'png',
	});
	return proxyImageResponse(url);
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/api/remove-background') {
			try {
				return await handleRemoveBackground(request, env);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return jsonError(msg, 502);
			}
		}

		if (request.method === 'POST' && url.pathname === '/api/upscale') {
			try {
				return await handleUpscale(request, env);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return jsonError(msg, 502);
			}
		}

		return jsonError('Not found', 404);
	},
} satisfies ExportedHandler<Env>;
