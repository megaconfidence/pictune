import clsx from 'clsx';
import type { ImageState, Tool } from '../types';

interface ImageViewerProps {
	image: ImageState;
	tool: Tool;
	zoom: number;
	processing: boolean;
	error: string | null;
}

/**
 * Single-image preview shown after a file is uploaded and the user is NOT in
 * compare mode.
 *
 * Per-tool rendering:
 *   - background: image floats on a checkerboard pattern. When the processed
 *     image has loaded, the cat (etc.) is on transparent bg so the checker
 *     shows through where the original background used to be.
 *   - retouch / expand / upscale: image rendered as-is on the canvas
 *     background.
 *
 * Overlays:
 *   - When the active tool is processing, we dim the image and show a small
 *     animated indicator.
 *   - When the active tool has errored, we show a one-line message anchored
 *     to the bottom of the image so the user can still see what they've got.
 */
export function ImageViewer({ image, tool, zoom, processing, error }: ImageViewerProps) {
	const showChecker = tool === 'background';

	return (
		<div className="relative grid place-items-center">
			<div
				className={clsx(
					'relative overflow-hidden rounded-lg image-outline',
					showChecker && 'bg-checker',
				)}
				style={{
					maxWidth: `min(${image.width}px, 60vw)`,
					transform: `scale(${zoom})`,
					transformOrigin: 'center center',
					transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
				}}
			>
				<img
					src={image.url}
					alt={image.name}
					draggable={false}
					className={clsx(
						'block h-auto w-full select-none transition-opacity duration-200',
						processing && 'opacity-40',
					)}
					style={{
						maxHeight: 'min(70vh, 800px)',
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
						<ProcessingBadge tool={tool} />
					</div>
				)}

				{error && !processing && (
					<div className="pointer-events-none absolute inset-x-3 bottom-3">
						<div className="rounded-md bg-red-600/95 px-3 py-2 text-[12.5px] leading-snug font-medium text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
							{error}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function ProcessingBadge({ tool }: { tool: Tool }) {
	const label =
		tool === 'background'
			? 'Removing background…'
			: tool === 'upscale'
				? 'Upscaling…'
				: 'Processing…';
	return (
		<div className="flex items-center gap-2.5 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[var(--color-ink)] shadow-[0_2px_4px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.08)]">
			<Spinner />
			<span>{label}</span>
		</div>
	);
}

function Spinner() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
			<circle
				cx="7"
				cy="7"
				r="5.5"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.15"
				strokeWidth="1.5"
			/>
			<path
				d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
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
