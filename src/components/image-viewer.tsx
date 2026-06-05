import clsx from 'clsx';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState, Tool } from '../types';

interface ImageViewerProps {
	image: ImageState;
	/** The tool whose label the processing badge shows (the running op). */
	tool: Tool;
	/**
	 * Float the image on a transparency checkerboard. Driven by the chain
	 * (true once a background removal is in the lineage) rather than the
	 * selected tool, so the checker tracks the actual image, not the panel.
	 */
	showChecker: boolean;
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
	showChecker,
	zoom,
	pan,
	smoothZoom,
	processing,
	processingStartedAt,
	error,
}: ImageViewerProps) {
	return (
		// `container-type: size` turns the canvas into a query container so
		// the image below can be sized with cqw/cqh units. Those resolve
		// against THIS box (the canvas) regardless of the shrink-to-fit frame
		// in between — a plain `max-height: 100%` on the image would resolve
		// against that auto-height frame, where a percentage doesn't bind, so
		// a tall image overflowed the frame and got clipped by its
		// `overflow-hidden`. The canvas always has a definite size (full
		// viewport on desktop, the flex-1 leftover on mobile).
		<div className="animate-rise relative grid h-full max-h-full w-full max-w-full place-items-center [container-type:size]">
			<div
				className={clsx(
					'image-outline relative overflow-hidden rounded-[12px]',
					showChecker && 'bg-checker',
				)}
				style={{
					// The frame shrink-wraps the image (which is itself sized
					// to fit the canvas below), so the outline / checker /
					// rounded corners always hug the image exactly.
					//
					// translate AFTER scale (right-most function runs first in
					// CSS transforms): that way pan.x maps to screen pixels 1:1
					// regardless of zoom.
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
						'block h-auto w-auto select-none',
						'transition-opacity duration-300',
						processing && 'opacity-35',
					)}
					// Fit the image inside the canvas while preserving aspect
					// ratio: both maxes bind on the replaced element, so the
					// browser scales it down to whichever constraint hits
					// first. cqw/cqh = % of the canvas (the query container
					// above), so the image never exceeds the visible area and
					// is never cropped. We also never upscale past the image's
					// natural size, and cap very large images at 980px tall.
					style={{
						maxWidth: `min(${image.width}px, 92cqw)`,
						maxHeight: `min(${image.height}px, 92cqh, 980px)`,
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
