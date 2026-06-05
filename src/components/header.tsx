import { Download, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { Button, Divider } from './ui';

interface HeaderProps {
	hasImage: boolean;
	canUndo: boolean;
	canRedo: boolean;
	compareActive: boolean;
	compareDisabled: boolean;
	downloadDisabled: boolean;
	onReset: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onCompare: () => void;
	onDownload: () => void;
}

/**
 * Top bar of the editor.
 *
 *   - Left: minimal "pictune" wordmark with a small teal dot accent.
 *     The dot is the only color moment on the left side and quietly
 *     anchors the brand. Nothing else lives on the left side — every
 *     action ships in the right-hand toolbar so the wordmark stays
 *     undisturbed.
 *   - Right: undo / redo / start-over (all icon-only and grouped as
 *     history actions), divider, Compare toggle, Download. All buttons
 *     share one hairline card so the toolbar reads as a single object.
 *
 * Responsive behavior:
 *   - Mobile (< md): in-flow flex item at the top of the column layout,
 *     compact padding, and the text labels on Compare / Download
 *     collapse so the whole toolbar fits at 390px viewport.
 *   - Desktop (≥ md): absolute, edge-to-edge, with `pointer-events:
 *     none` on the bar so the central canvas can still receive wheel
 *     and drag events through any empty space between the corners.
 */
export function Header({
	hasImage,
	canUndo,
	canRedo,
	compareActive,
	compareDisabled,
	downloadDisabled,
	onReset,
	onUndo,
	onRedo,
	onCompare,
	onDownload,
}: HeaderProps) {
	return (
		<header
			className={[
				'z-20 flex flex-shrink-0 items-start justify-between gap-2 p-3',
				'md:pointer-events-none md:absolute md:inset-x-0 md:top-0 md:p-5',
			].join(' ')}
		>
			{/* Left: just the wordmark — minimal, no link clutter */}
			<div className="pointer-events-auto pl-1 pt-1.5">
				<a
					href="/"
					className="group flex items-center gap-1.5 -ml-1 px-1 py-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]"
					aria-label="Pictune — home"
				>
					<span className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
						pictune
					</span>
					<span
						aria-hidden
						className="block h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]"
					/>
				</a>
			</div>

			{/* Right: history (undo / redo / start-over) + compare + download */}
			{hasImage && (
				<div className="card pointer-events-auto flex items-center gap-0.5 p-1 md:p-1.5">
					<Button
						variant="icon"
						aria-label="Undo"
						disabled={!canUndo}
						onClick={onUndo}
					>
						<Undo2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
					</Button>
					<Button
						variant="icon"
						aria-label="Redo"
						disabled={!canRedo}
						onClick={onRedo}
					>
						<Redo2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
					</Button>
					{/*
					 * Start over — same icon-only slot as undo/redo because
					 * it lives in the same conceptual family (history /
					 * canvas state). Distinct icon (rotate-ccw) so it
					 * can't be confused with the curved-arrow undo.
					 */}
					<Button
						variant="icon"
						aria-label="Start over — clear the canvas"
						title="Start over"
						onClick={onReset}
					>
						<RotateCcw className="h-[15px] w-[15px]" strokeWidth={1.85} />
					</Button>
					<Divider />
					{/*
					 * Compare / Download collapse to icon-only on mobile
					 * to keep the whole bar inside a 390px viewport. The
					 * accessible name (aria-label / visible-on-desktop
					 * span) survives both layouts.
					 */}
					<Button
						variant="toggle"
						active={compareActive}
						disabled={compareDisabled}
						onClick={onCompare}
						aria-label="Compare"
						title="Compare"
						className="px-2.5 md:px-3.5"
						leadingIcon={<CompareIcon active={compareActive} />}
					>
						<span className="hidden md:inline">Compare</span>
					</Button>
					<Button
						variant="primary"
						disabled={downloadDisabled}
						aria-label="Download"
						title="Download"
						className="px-2.5 md:px-3.5"
						leadingIcon={<Download className="h-[14px] w-[14px]" strokeWidth={2.25} />}
						onClick={onDownload}
					>
						<span className="hidden md:inline">Download</span>
					</Button>
				</div>
			)}
		</header>
	);
}

/**
 * Compact split-square icon — visually represents the before/after slider.
 * Custom because lucide's stock icon has the wrong proportions for our
 * 15px slot. The filled half flips color when the toggle is active.
 */
function CompareIcon({ active }: { active: boolean }) {
	const stroke = active ? 'white' : 'currentColor';
	const fill = active ? 'white' : 'currentColor';
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
		>
			<rect
				x="2"
				y="2"
				width="12"
				height="12"
				rx="2.5"
				stroke={stroke}
				strokeWidth="1.5"
			/>
			<path d="M8 2.5V13.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
			<path
				d="M2.75 4.5C2.75 3.5335 3.5335 2.75 4.5 2.75H8V13.25H4.5C3.5335 13.25 2.75 12.4665 2.75 11.5V4.5Z"
				fill={fill}
				opacity="0.95"
			/>
		</svg>
	);
}
