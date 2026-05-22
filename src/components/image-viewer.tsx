import clsx from 'clsx';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState, Tool } from '../types';

interface ImageViewerProps {
	image: ImageState;
	tool: Tool;
	zoom: number;
	/**
	 * Screen-pixel translation applied to the image. Combined with
	 * `zoom` as `translate(...) scale(...)` so the translate maps 1:1 to
	 * screen pixels at any zoom level.
	 */
	pan: { x: number; y: number };
	/**
	 * Whether to animate zoom changes. False while a wheel/pinch gesture
	 * or a pan-drag is in progress so the image tracks the input 1:1;
	 * true for button clicks (and ~150ms after the wheel stops) so they
	 * animate.
	 */
	smoothZoom: boolean;
	processing: boolean;
	/** Timestamp (ms since epoch) of when the current job started, or null. */
	processingStartedAt: number | null;
	error: string | null;
}

/** Hide the live counter for the first couple of seconds — it's just noise. */
const ELAPSED_VISIBLE_AFTER_MS = 3000;

/**
 * Single-image preview shown after a file is uploaded and the user is NOT
 * in compare mode.
 *
 * Per-tool rendering:
 *   - background: image floats on a subtle checkerboard. When the
 *     processed image has loaded, the subject sits on transparent so
 *     the checker shows through where the background used to be.
 *   - expand / upscale: image renders on the white canvas as-is.
 *
 * Overlays:
 *   - While processing, the image dims and a white pill at the center
 *     reports the action + elapsed time (after 3s).
 *   - On error, a one-line teal pill anchored to the bottom of the
 *     image surfaces the message — visible without pushing the image.
 */
export function ImageViewer({
	image,
	tool,
	zoom,
	pan,
	smoothZoom,
	processing,
	processingStartedAt,
	error,
}: ImageViewerProps) {
	const showChecker = tool === 'background';

	return (
		<div className="relative grid place-items-center animate-rise">
			<div
				className={clsx(
					'image-outline relative overflow-hidden rounded-[12px]',
					showChecker && 'bg-checker',
				)}
				style={{
					// Bigger max footprint than the old 60vw / 72vh — the
					// side panels are floating overlays now so the image
					// is free to use almost the full canvas. We still
					// hold back ~4vw / 8vh so a fit-zoomed image doesn't
					// run completely under the floating cards.
					maxWidth: `min(${image.width}px, 92vw)`,
					// translate AFTER scale (right-most function runs
					// first in CSS transforms): that way pan.x maps to
					// screen pixels 1:1 regardless of zoom.
					transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
					transformOrigin: 'center center',
					// Only ease for discrete (button) zoom changes. During
					// continuous wheel/pinch input or active drag, the
					// parent flips this off so the scale/translate track
					// the gesture without lag.
					transition: smoothZoom
						? 'transform 240ms cubic-bezier(0.2, 0, 0, 1)'
						: 'none',
				}}
			>
				<img
					src={image.url}
					alt={image.name}
					draggable={false}
					className={clsx(
						'block h-auto w-full select-none',
						'transition-opacity duration-300',
						processing && 'opacity-35',
					)}
					style={{
						maxHeight: 'min(84vh, 980px)',
						width: 'auto',
						maxWidth: '100%',
					}}
				/>

				{processing && (
					<div
						className="pointer-events-none absolute inset-0 grid place-items-center"
						aria-live="polite"
						aria-busy
					>
						<ProcessingBadge tool={tool} startedAt={processingStartedAt} />
					</div>
				)}

				{error && !processing && (
					<div className="pointer-events-none absolute inset-x-3 bottom-3">
						<div className="rounded-[10px] bg-[var(--color-ink)] px-3.5 py-2 text-[12.5px] leading-snug font-medium text-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.2)]">
							{error}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Floating status pill while a tool is running. White surface so it
 * remains legible regardless of what's behind it (canvas, dimmed image,
 * or transparent checkerboard).
 */
function ProcessingBadge({ tool, startedAt }: { tool: Tool; startedAt: number | null }) {
	const elapsedMs = useElapsed(startedAt);
	const showElapsed = elapsedMs >= ELAPSED_VISIBLE_AFTER_MS;
	const label =
		tool === 'background'
			? 'Removing background…'
			: tool === 'upscale'
				? 'Upscaling…'
				: tool === 'expand'
					? 'Expanding…'
					: 'Processing…';
	return (
		<div className="flex items-center gap-2.5 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[var(--color-ink)] shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)]">
			<Spinner />
			<span>{label}</span>
			{showElapsed && (
				<span className="tabular-nums text-[var(--color-ink-muted)]">
					{formatElapsed(elapsedMs)}
				</span>
			)}
		</div>
	);
}

/**
 * Teal-stroked progress spinner. Inline SVG so the colors hit exact
 * brand values regardless of the parent's `currentColor`.
 */
function Spinner() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
			<circle
				cx="7"
				cy="7"
				r="5.5"
				fill="none"
				stroke="var(--color-ink-faint)"
				strokeWidth="1.5"
			/>
			<path
				d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
				fill="none"
				stroke="var(--color-brand)"
				strokeWidth="1.75"
				strokeLinecap="round"
			>
				<animateTransform
					attributeName="transform"
					type="rotate"
					from="0 7 7"
					to="360 7 7"
					dur="0.9s"
					repeatCount="indefinite"
				/>
			</path>
		</svg>
	);
}
