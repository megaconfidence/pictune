export type Tool = 'background' | 'expand' | 'upscale';

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

/* ──────────────────────────────────────────────────────────────────────── *
 * Per-tool result state + undo/redo                                         *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The cached result for each tool. `null` means "not yet run" (or undone).
 * These types are referenced from the Action discriminated union so that
 * undo/redo can restore them losslessly without re-running the API.
 */
export type BackgroundState = ImageState | null;

export interface UpscaleResultData {
	image: ImageState;
	settings: UpscaleSettings;
}
export type UpscaleState = UpscaleResultData | null;

/**
 * One entry in the undo / redo history. Records a single transition for a
 * single tool's cached result — produced when the user clicks Run (records
 * `{ before: prior, after: newResult }`) or X (records
 * `{ before: prior, after: null }`).
 *
 * Per-tool discrimination keeps before/after type-safe: a 'background'
 * action's before/after are both `BackgroundState`, etc. This means undo /
 * redo can apply either side without runtime type tags on the payloads.
 */
export type Action =
	| { tool: 'background'; before: BackgroundState; after: BackgroundState }
	| { tool: 'upscale'; before: UpscaleState; after: UpscaleState }
	| { tool: 'expand'; before: ExpandResultState; after: ExpandResultState };

/* ──────────────────────────────────────────────────────────────────────── *
 * Expand tool                                                               *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Ratios the bria/expand-image model accepts. The model rejects everything
 * else (including custom floats — despite the description claiming
 * otherwise), so the UI is built around snapping to one of these.
 */
export const ASPECT_RATIO_PRESETS = [
	'1:1',
	'16:9',
	'9:16',
	'3:2',
	'2:3',
	'4:3',
	'3:4',
	'4:5',
	'5:4',
] as const;

export type AspectRatioPreset = (typeof ASPECT_RATIO_PRESETS)[number];

/**
 * The dropdown value. `'custom'` means "use the W/H inputs to derive a
 * ratio, then snap to the closest preset" — the model can't actually
 * accept arbitrary canvas sizes so we surface the chosen preset to the
 * user via the preview readout.
 */
export type AspectRatioChoice = AspectRatioPreset | 'custom';

export interface ExpandSettings {
	choice: AspectRatioChoice;
	/** Width input (drives ratio when in Custom; preview in preset modes). */
	width: number;
	/** Height input (drives ratio when in Custom; preview in preset modes). */
	height: number;
	/**
	 * Chain icon state: when true, editing one of W/H proportionally
	 * updates the other. Only really meaningful in Custom mode — preset
	 * modes always behave as if linked.
	 */
	linked: boolean;
}

/**
 * Cached output of the Expand tool. Stores the chosen ratio alongside the
 * image so the panel can show "Target 16:9" even after the user navigates
 * away and back.
 */
export interface ExpandResultData {
	image: ImageState;
	ratio: AspectRatioPreset;
}
export type ExpandResultState = ExpandResultData | null;

/** Parse a preset like `'16:9'` into the numeric pair `[16, 9]`. */
export function parseRatio(preset: AspectRatioPreset): [number, number] {
	const [w, h] = preset.split(':').map(Number);
	return [w, h];
}

/**
 * Compute the dimensions the model will return for a given source +
 * target ratio. The model keeps one of the source dimensions and grows
 * the other to satisfy the ratio (it never shrinks the source), so we
 * mirror that math to give the UI an accurate after-size preview.
 */
export function expandDimensionsForRatio(
	srcWidth: number,
	srcHeight: number,
	ratioW: number,
	ratioH: number,
): { width: number; height: number } {
	const srcRatio = srcWidth / srcHeight;
	const targetRatio = ratioW / ratioH;
	if (targetRatio > srcRatio) {
		// Target wider than source → keep height, grow width.
		return { width: Math.round(srcHeight * targetRatio), height: srcHeight };
	}
	if (targetRatio < srcRatio) {
		// Target taller than source → keep width, grow height.
		return { width: srcWidth, height: Math.round(srcWidth / targetRatio) };
	}
	return { width: srcWidth, height: srcHeight };
}

/**
 * Snap an arbitrary W×H to the supported preset whose ratio is closest.
 * Used in Custom mode — we keep the user's typed numbers in the inputs
 * for visual continuity but tell them (and the model) which preset will
 * actually be applied.
 */
export function snapToNearestPreset(width: number, height: number): AspectRatioPreset {
	if (width <= 0 || height <= 0) return '1:1';
	const target = width / height;
	let best: AspectRatioPreset = '1:1';
	let bestDelta = Infinity;
	for (const preset of ASPECT_RATIO_PRESETS) {
		const [w, h] = parseRatio(preset);
		const delta = Math.abs(w / h - target);
		if (delta < bestDelta) {
			bestDelta = delta;
			best = preset;
		}
	}
	return best;
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
