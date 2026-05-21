import { ChevronLeft, Download, Redo2, Undo2 } from 'lucide-react';
import { Button, Divider } from './ui';

interface HeaderProps {
	hasImage: boolean;
	canUndo: boolean;
	canRedo: boolean;
	compareActive: boolean;
	compareDisabled: boolean;
	downloadDisabled: boolean;
	onBack: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onCompare: () => void;
	onDownload: () => void;
	onOpenDesigner: () => void;
}

/**
 * Top bar of the editor.
 *
 *   - Left pill: back arrow + "Get Pro" CTA. Always visible.
 *   - Right toolbar: undo / redo / compare / download / open designer. Only
 *     visible when an image has been loaded, matching designs 2–5.
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
	onBack,
	onUndo,
	onRedo,
	onCompare,
	onDownload,
	onOpenDesigner,
}: HeaderProps) {
	return (
		<header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-5">
			{/* Left: back + Get Pro */}
			<div className="card pointer-events-auto flex items-center gap-1 p-1.5">
				<Button variant="icon" aria-label="Go back" onClick={onBack}>
					<ChevronLeft className="h-5 w-5" strokeWidth={2} />
				</Button>
				<Button
					variant="primary"
					className="h-9 px-4 text-[13px]"
					aria-label="Upgrade to Pro"
				>
					Get Pro
				</Button>
			</div>

			{/* Right: undo/redo + compare + download + open designer */}
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
					<Button variant="secondary" onClick={onOpenDesigner}>
						Open Designer
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
