import { HelpCircle, Maximize, Minus, Plus } from 'lucide-react';
import { Button } from './ui';

interface BottomControlsProps {
	zoom: number;
	hasImage: boolean;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFit: () => void;
	onHelp: () => void;
}

/**
 * Two floating clusters in the bottom-right:
 *
 *   - Zoom group:  −  ⛶  +    (only when an image is loaded)
 *   - Help button: ?           (always)
 *
 * Both are pinned to the bottom-right corner with `pointer-events: none` on
 * the wrapper so they don't block the canvas — the children re-enable it.
 */
export function BottomControls({
	zoom,
	hasImage,
	onZoomIn,
	onZoomOut,
	onFit,
	onHelp,
}: BottomControlsProps) {
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
						className="h-9 w-9 rounded-lg"
						aria-label="Zoom out"
						onClick={onZoomOut}
					>
						<Minus className="h-4 w-4" strokeWidth={2} />
					</Button>
					<Button
						variant="icon"
						className="h-9 w-9 rounded-lg"
						aria-label={`Fit to screen — current ${Math.round(zoom * 100)}%`}
						onClick={onFit}
					>
						<Maximize className="h-4 w-4" strokeWidth={2} />
					</Button>
					<Button
						variant="icon"
						className="h-9 w-9 rounded-lg"
						aria-label="Zoom in"
						onClick={onZoomIn}
					>
						<Plus className="h-4 w-4" strokeWidth={2} />
					</Button>
				</div>
			)}
			<div className="card pointer-events-auto flex items-center p-1">
				<Button
					variant="icon"
					className="h-9 w-9 rounded-lg"
					aria-label="Help"
					onClick={onHelp}
				>
					<HelpCircle className="h-4 w-4" strokeWidth={2} />
				</Button>
			</div>
		</div>
	);
}
