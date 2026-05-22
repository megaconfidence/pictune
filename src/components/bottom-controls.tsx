import { Heart, HelpCircle, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

interface BottomControlsProps {
	zoom: number;
	hasImage: boolean;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFit: () => void;
}

/**
 * Two floating clusters in the bottom-right:
 *
 *   - Zoom group:  −  100%  +    (only when an image is loaded; click
 *     the % to fit to screen)
 *   - About button: ?            (always — opens a small credit popover)
 *
 * Both clusters live in `pointer-events: none` wrappers; their children
 * re-enable it so the underlying canvas stays drag-droppable when empty.
 *
 * The credit popover is co-located with its trigger so positioning,
 * focus, and outside-click dismissal can be managed with one ref.
 */
export function BottomControls({
	zoom,
	hasImage,
	onZoomIn,
	onZoomOut,
	onFit,
}: BottomControlsProps) {
	const [creditOpen, setCreditOpen] = useState(false);
	const creditRef = useRef<HTMLDivElement>(null);

	// Close popover on outside click + Escape. Effect only runs while
	// open so we don't pay for the listeners 99% of the time.
	// `pointerdown` (not `click`) fires before the synthetic click on
	// the trigger, so we check containment against the wrapper which
	// includes the trigger — a click on the trigger itself is handled
	// by its own onClick (which toggles).
	useEffect(() => {
		if (!creditOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!creditRef.current?.contains(event.target as Node)) {
				setCreditOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setCreditOpen(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [creditOpen]);

	const zoomPct = Math.round(zoom * 100);

	return (
		<div className="pointer-events-none absolute right-5 bottom-5 z-10 flex items-end gap-2">
			{hasImage && (
				<div
					className="card pointer-events-auto flex items-center gap-0.5 p-1"
					role="group"
					aria-label="Zoom"
				>
					<Button
						variant="icon"
						className="h-8 w-8 rounded-[9px]"
						aria-label="Zoom out"
						onClick={onZoomOut}
					>
						<Minus className="h-[14px] w-[14px]" strokeWidth={2.25} />
					</Button>
					<button
						type="button"
						onClick={onFit}
						className="h-8 min-w-[3.25rem] rounded-[9px] px-1.5 text-[12px] font-medium tabular-nums text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]"
						aria-label={`Fit to screen — currently ${zoomPct}%`}
						title="Fit to screen"
					>
						{zoomPct}%
					</button>
					<Button
						variant="icon"
						className="h-8 w-8 rounded-[9px]"
						aria-label="Zoom in"
						onClick={onZoomIn}
					>
						<Plus className="h-[14px] w-[14px]" strokeWidth={2.25} />
					</Button>
				</div>
			)}

			<div ref={creditRef} className="pointer-events-auto relative">
				<div className="card flex items-center p-1">
					<Button
						variant="icon"
						className="h-8 w-8 rounded-[9px]"
						aria-label="About Pictune"
						aria-expanded={creditOpen}
						aria-haspopup="dialog"
						onClick={() => setCreditOpen((open) => !open)}
					>
						<HelpCircle className="h-[14px] w-[14px]" strokeWidth={2} />
					</Button>
				</div>
				{/*
				 * Popover. Always rendered so the transform animates on
				 * close too. `pointer-events-none` when hidden prevents
				 * the invisible element from intercepting clicks on the
				 * canvas.
				 *
				 * Transform origin is bottom-right so the scale animation
				 * grows outward from the trigger button below it.
				 */}
				<div
					role="dialog"
					aria-label="About Pictune"
					aria-hidden={!creditOpen}
					inert={!creditOpen}
					className={[
						'card absolute right-0 bottom-full mb-2 origin-bottom-right whitespace-nowrap px-3.5 py-2.5 text-[12.5px] leading-none',
						'transition duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
						creditOpen
							? 'translate-y-0 scale-100 opacity-100'
							: 'pointer-events-none translate-y-1 scale-95 opacity-0',
					].join(' ')}
				>
					<span className="text-[var(--color-ink-muted)]">Made with</span>
					<Heart
						className="mx-1 inline-block h-3 w-3 -translate-y-px text-[var(--color-brand)]"
						fill="currentColor"
						strokeWidth={0}
						aria-label="love"
					/>
					<span className="text-[var(--color-ink-muted)]">by</span>{' '}
					<a
						href="https://x.com/megaconfidence"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-[var(--color-ink)] underline decoration-[var(--color-brand)] decoration-1.5 underline-offset-[3px] transition-colors hover:text-[var(--color-brand)] focus-visible:text-[var(--color-brand)] focus-visible:outline-none"
					>
						Confidence
					</a>
				</div>
			</div>
		</div>
	);
}
