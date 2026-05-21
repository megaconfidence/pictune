export type Tool = 'background' | 'retouch' | 'expand' | 'upscale';

export type UpscaleMode = 'fast' | 'quality';
export type UpscaleFactor = 2 | 4;

/**
 * A renderable image — either the user's original upload or a processed
 * result that came back from the Worker. `url` is an object URL we own and
 * are responsible for revoking when the image is replaced or unmounted.
 */
export interface ImageState {
	url: string;
	name: string;
	width: number;
	height: number;
}

export interface UpscaleSettings {
	mode: UpscaleMode;
	factor: UpscaleFactor;
}

/**
 * Probe a Blob to read its intrinsic dimensions, then build an `ImageState`.
 * Used after every successful API response so the compare slider can show
 * accurate "After: WxH" labels even when the server's reported size disagrees
 * with the math.
 */
export async function blobToImageState(blob: Blob, name: string): Promise<ImageState> {
	const url = URL.createObjectURL(blob);
	const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => reject(new Error(`Failed to decode ${name}`));
		img.src = url;
	});
	return { url, name, ...dims };
}
