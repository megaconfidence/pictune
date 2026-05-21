import type { UpscaleSettings } from './types';

/**
 * Thin typed wrapper around the Worker endpoints. Both routes return raw image
 * bytes (image/png) on success and `{ error: string }` JSON on failure.
 *
 * All requests accept an AbortSignal so the app can cancel in-flight work
 * when the user uploads a new image or switches tools mid-flight.
 */

async function unwrapError(res: Response, fallback: string): Promise<string> {
	try {
		const body = (await res.json()) as { error?: string };
		if (body && typeof body.error === 'string') return body.error;
	} catch {
		/* response wasn't JSON — fall through */
	}
	return `${fallback} (${res.status})`;
}

export async function removeBackground(file: File, signal?: AbortSignal): Promise<Blob> {
	const form = new FormData();
	form.append('image', file);

	const res = await fetch('/api/remove-background', {
		method: 'POST',
		body: form,
		signal,
	});
	if (!res.ok) throw new Error(await unwrapError(res, 'Background removal failed'));
	return res.blob();
}

export async function upscale(
	file: File,
	settings: UpscaleSettings,
	signal?: AbortSignal,
): Promise<Blob> {
	const form = new FormData();
	form.append('image', file);
	form.append('scale_factor', String(settings.factor));
	form.append('mode', settings.mode);

	const res = await fetch('/api/upscale', {
		method: 'POST',
		body: form,
		signal,
	});
	if (!res.ok) throw new Error(await unwrapError(res, 'Upscale failed'));
	return res.blob();
}
