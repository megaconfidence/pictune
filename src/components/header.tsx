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
 *   - Left pill: reset. Wipes the canvas back to the drop-zone state —
 *     clears the source image, every cached result, and any in-flight job.
 *     Only rendered once an image is loaded, since there's nothing to reset
 *     from on the drop-zone screen.
 *   - Right toolbar: undo / redo / compare / download. Same visibility rule.
 *
 * Both groups are absolutely positioned to the corners so the header doesn't
 * compete with the central canvas for vertical space.
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
		<header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-5">
			{/* Left: reset */}
			{hasImage ? (
				<div className="card pointer-events-auto flex items-center p-1.5">
					<Button
						variant="icon"
						aria-label="Reset canvas"
						title="Reset canvas"
						onClick={onReset}
					>
						<RotateCcw className="h-5 w-5" strokeWidth={2} />
					</Button>
				</div>
			) : (
				// Keep a flex placeholder so the right toolbar stays right-aligned
				// when there's no image yet.
				<div />
			)}

			{/* Right: undo/redo + compare + download */}
			{hasImage && (
				<div className="card pointer-events-auto flex items-center gap-1 p-1.5">
					<Button
						variant="icon"
						aria-label="Undo"
						disabled={!canUndo}
						onClick={onUndo}
					>
						<Undo2 className="h-5 w-5" strokeWidth={2} />
					</Button>
					<Button
						variant="icon"
						aria-label="Redo"
						disabled={!canRedo}
						onClick={onRedo}
					>
						<Redo2 className="h-5 w-5" strokeWidth={2} />
					</Button>
					<Divider />
					<Button
						variant="toggle"
						active={compareActive}
						disabled={compareDisabled}
						onClick={onCompare}
						leadingIcon={<CompareIcon active={compareActive} />}
					>
						Compare
					</Button>
					<Button
						variant="primary"
						disabled={downloadDisabled}
						leadingIcon={<Download className="h-4 w-4" strokeWidth={2.25} />}
						onClick={onDownload}
					>
						Download
					</Button>
				</div>
			)}
		</header>
	);
}

/**
 * Custom split-square icon. lucide's stock icon doesn't quite match the
 * design: it's a vertical line with a half-filled square. Inlining a tiny SVG
 * is cheaper than fighting the framework.
 */
function CompareIcon({ active }: { active: boolean }) {
	const stroke = active ? 'white' : 'currentColor';
	const fill = active ? 'white' : 'currentColor';
	return (
		<svg
			width="16"
			height="16"
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
