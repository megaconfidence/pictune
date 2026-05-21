import type { AspectRatioPreset, UpscaleSettings } from './types';

/**
 * Client-side driver for the async prediction lifecycle.
 *
 *   1. POST /api/remove-background or /api/upscale → { id }
 *   2. GET  /api/predictions/:id  (polled with exponential backoff + jitter)
 *   3. GET  /api/predictions/:id/output  (stream the result PNG when status = succeeded)
 *
 * Why client-driven polling instead of `Prefer: wait` on a single long-open
 * request? Two reasons:
 *
 *   - On the Workers free plan each invocation gets at most 50 subrequests.
 *     A server-side poll loop chews through that budget for one job; with
 *     client polling each poll is a fresh invocation with its own budget.
 *
 *   - Long-open requests are fragile on mobile / flaky networks. A single
 *     dropped connection cancels everything (and burns the Replicate
 *     credit). Short polls survive transient blips.
 */

/* ──────────────────────────────────────────────────────────────────────── *
 * Tuning                                                                    *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Backoff schedule for the status poll. We open with a 1s delay (most
 * background-removal calls finish in 3–6s, so this catches them fast), then
 * multiply by 1.5 each attempt until we hit the cap. ±20% jitter keeps
 * many simultaneous tabs from synchronising and hammering the Worker on
 * the same tick.
 *
 *   attempts:  1     2     3     4      5+
 *   delay:    1.0s  1.5s  2.25s  3.4s   5s (capped)
 */
const POLL_INITIAL_MS = 1000;
const POLL_MULTIPLIER = 1.5;
const POLL_MAX_MS = 5000;
const POLL_JITTER = 0.2;

/** Hard wall: give up on a single prediction after this long. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Tolerate this many consecutive failed polls before bailing. A poll can fail
 * because of a transient network blip, the user's connection switching
 * (e.g. wifi → cellular), or a Worker cold-start. Counter resets on success.
 */
const POLL_TRANSIENT_TOLERANCE = 3;

/* ──────────────────────────────────────────────────────────────────────── *
 * Types                                                                     *
 * ──────────────────────────────────────────────────────────────────────── */

export type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface PredictionProgress {
	status: PredictionStatus;
	attempt: number;
	elapsedMs: number;
}

interface PredictionResponse {
	id: string;
	status: PredictionStatus;
	output?: string;
	error?: string;
}

interface RunOptions {
	signal?: AbortSignal;
	onProgress?: (progress: PredictionProgress) => void;
	/**
	 * Cloudflare Turnstile token — single-use, ~5-minute lifetime, obtained
	 * from the widget rendered by TurnstileProvider. Required for the start
	 * POST; not used by the poll or output fetches (those are unguarded by
	 * design — see server.ts header comment for why).
	 */
	turnstileToken: string;
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Public entry points                                                       *
 * ──────────────────────────────────────────────────────────────────────── */

export async function removeBackground(file: File, options: RunOptions): Promise<Blob> {
	const form = new FormData();
	form.append('image', file);
	return await runPrediction('/api/remove-background', form, options);
}

export async function upscale(
	file: File,
	settings: UpscaleSettings,
	options: RunOptions,
): Promise<Blob> {
	const form = new FormData();
	form.append('image', file);
	form.append('scale_factor', String(settings.factor));
	form.append('mode', settings.mode);
	return await runPrediction('/api/upscale', form, options);
}

export async function expand(
	file: File,
	aspectRatio: AspectRatioPreset,
	options: RunOptions,
): Promise<Blob> {
	const form = new FormData();
	form.append('image', file);
	form.append('aspect_ratio', aspectRatio);
	return await runPrediction('/api/expand', form, options);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Orchestration                                                             *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The full lifecycle: start → poll → fetch bytes. Wired so the caller's
 * AbortSignal short-circuits any step and fires a cancel to Replicate
 * (best-effort — we don't await it).
 */
async function runPrediction(
	startEndpoint: string,
	form: FormData,
	{ signal, onProgress, turnstileToken }: RunOptions,
): Promise<Blob> {
	throwIfAborted(signal);

	// Turnstile token rides in a header (not a form field) so the Worker can
	// read it without consuming the multipart body — the start handlers
	// need the FormData themselves to pull out the image bytes.
	const startRes = await fetch(startEndpoint, {
		method: 'POST',
		body: form,
		signal,
		headers: { 'cf-turnstile-response': turnstileToken },
	});
	if (!startRes.ok) {
		throw new Error(await readError(startRes, 'Failed to start prediction'));
	}
	const initial = (await startRes.json()) as PredictionResponse;

	// Defensive cleanup: if the caller aborts at any point after we have an
	// id, ask Replicate to stop work. fire-and-forget; the Worker swallows
	// errors and Replicate is idempotent for already-finished predictions.
	const onAbort = () => {
		void fetch(`/api/predictions/${encodeURIComponent(initial.id)}/cancel`, {
			method: 'POST',
			keepalive: true,
		}).catch(() => {});
	};
	signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const outputUrl = await pollUntilDone(initial, { signal, onProgress });
		return await fetchOutput(outputUrl, signal);
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

/** The bits of RunOptions that the poll loop actually needs. */
type PollOptions = Pick<RunOptions, 'signal' | 'onProgress'>;

/**
 * Poll the status endpoint with exponential backoff + jitter until the
 * prediction reaches a terminal state. Returns the worker-proxied output URL
 * on success; throws on failure, cancel, abort, or timeout.
 *
 * No Turnstile token needed here: polling is unguarded server-side. See the
 * header comment in src/server.ts for why.
 */
async function pollUntilDone(
	initial: PredictionResponse,
	{ signal, onProgress }: PollOptions,
): Promise<string> {
	const startedAt = Date.now();
	let attempt = 0;
	let consecutiveFailures = 0;
	let current = initial;

	// Surface the initial status before sleeping, so the UI can flip to
	// "Starting…" / "Processing…" immediately.
	onProgress?.({ status: current.status, attempt: 0, elapsedMs: 0 });

	while (true) {
		throwIfAborted(signal);

		if (current.status === 'succeeded') {
			if (!current.output) throw new Error('Prediction succeeded but has no output URL');
			return current.output;
		}
		if (current.status === 'failed' || current.status === 'canceled') {
			throw new Error(current.error || `Prediction ${current.status}`);
		}

		const elapsed = Date.now() - startedAt;
		if (elapsed > POLL_TIMEOUT_MS) {
			throw new Error(`Timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`);
		}

		attempt += 1;
		await sleep(nextDelay(attempt), signal);

		try {
			const res = await fetch(
				`/api/predictions/${encodeURIComponent(current.id)}`,
				{ signal },
			);
			if (!res.ok) throw new Error(await readError(res, `Poll ${res.status}`));
			current = (await res.json()) as PredictionResponse;
			consecutiveFailures = 0;
			onProgress?.({
				status: current.status,
				attempt,
				elapsedMs: Date.now() - startedAt,
			});
		} catch (err) {
			// AbortError is intentional — let it bubble.
			if (isAbortError(err)) throw err;
			consecutiveFailures += 1;
			if (consecutiveFailures > POLL_TRANSIENT_TOLERANCE) {
				throw err;
			}
			// Otherwise loop again — the next sleep applies the next backoff
			// step, giving Replicate / the Worker a moment to recover.
		}
	}
}

/** Stream the result image off the Worker. */
async function fetchOutput(outputUrl: string, signal?: AbortSignal): Promise<Blob> {
	const res = await fetch(outputUrl, { signal });
	if (!res.ok) throw new Error(await readError(res, 'Failed to fetch output'));
	return res.blob();
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Utilities                                                                 *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Compute the next backoff delay (in ms) given the 1-based attempt counter.
 * Capped at POLL_MAX_MS, jittered by ±POLL_JITTER.
 */
function nextDelay(attempt: number): number {
	const base = Math.min(
		POLL_INITIAL_MS * Math.pow(POLL_MULTIPLIER, attempt - 1),
		POLL_MAX_MS,
	);
	const jitter = base * POLL_JITTER * (Math.random() * 2 - 1);
	return Math.max(0, base + jitter);
}

/** Promise-based sleep that respects AbortSignal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
	return new DOMException('Aborted', 'AbortError');
}

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

async function readError(res: Response, fallback: string): Promise<string> {
	try {
		const body = (await res.json()) as { error?: string };
		if (body && typeof body.error === 'string') return body.error;
	} catch {
		/* response wasn't JSON — fall through */
	}
	return `${fallback} (${res.status})`;
}
