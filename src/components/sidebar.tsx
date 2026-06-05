import clsx from 'clsx';
import { Eraser, Frame, Sparkles, X } from 'lucide-react';
import type { Tool } from '../types';

interface SidebarProps {
	activeTool: Tool;
	/** True for each tool that currently has a cached result. */
	results: Record<Tool, boolean>;
	onSelectTool: (tool: Tool) => void;
	/** Per-tool X: undo just this tool's transformation. */
	onClearResult: (tool: Tool) => void;
}

/**
 * Tool definitions: short label, one-line description, and an icon.
 * Icons hint at the action, not the model:
 *   - Eraser   → background removal
 *   - Frame    → expand (outpaint)
 *   - Sparkles → upscale (the "enhance" connotation)
 */
const TOOLS: { id: Tool; label: string; desc: string; Icon: typeof Eraser }[] = [
	{ id: 'background', label: 'Background', desc: 'Cut out the subject', Icon: Eraser },
	{ id: 'expand', label: 'Expand', desc: 'Grow the canvas', Icon: Frame },
	{ id: 'upscale', label: 'Upscale', desc: 'Sharpen and enlarge', Icon: Sparkles },
];

/**
 * Tool rail.
 *
 * Mobile (< md): a horizontal strip of three equal-width tabs. Each
 * tab shows an icon over a short label; the description is hidden to
 * keep each cell narrow enough that "Background / Expand / Upscale"
 * all fit at a 390px viewport.
 *
 * Desktop (≥ md): a vertical rail with full label + description and a
 * hover-reveal clear-X on rows that have a cached result. The footer
 * ("Free to use · No sign-in / Unlimited transformations") only shows
 * here — on mobile there's no room for it without crowding the canvas.
 *
 *   - Active row/tab: teal-tinted icon tile on a soft-gray background.
 *     One quiet color signal per item — the same teal that appears in
 *     the wordmark dot and primary CTAs.
 *   - Result dot: small teal pip next to the label, shown when that
 *     tool has produced an image. Stays visible in both layouts.
 *   - Clear-X (desktop only): clears just that tool's result via an
 *     action so the change lands in the undo stack. Stopped from
 *     bubbling so the parent row's onClick doesn't re-select what
 *     we're trying to clear.
 */
export function Sidebar({ activeTool, results, onSelectTool, onClearResult }: SidebarProps) {
	return (
		<aside
			className={clsx(
				'card-floating animate-rise flex-shrink-0 p-2',
				'w-full md:w-[220px] md:p-2.5',
			)}
			style={{ animationDelay: '80ms' }}
			aria-label="Editor tools"
		>
			<ul
				className={clsx(
					// Mobile: 3 equal tabs across; desktop: stacked rail.
					'flex gap-0.5',
					'flex-row md:flex-col',
				)}
			>
				{TOOLS.map(({ id, label, desc, Icon }) => {
					const active = id === activeTool;
					const hasResult = results[id];
					return (
						<li key={id} className="flex-1 md:flex-initial">
							<button
								onClick={() => onSelectTool(id)}
								aria-pressed={active}
								className={clsx(
									'group relative flex w-full rounded-[10px] text-left',
									'transition-[background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]',
									// Mobile: icon stacked over label, centered.
									// Desktop: icon-tile + label/desc stack in a row.
									'h-[60px] flex-col items-center justify-center gap-1 px-1',
									'md:h-[56px] md:flex-row md:items-center md:justify-start md:gap-3 md:px-2',
									active
										? 'bg-[var(--color-surface-soft)]'
										: 'hover:bg-[var(--color-surface-soft)]/60',
								)}
							>
								{/*
								 * Icon tile. Teal-on-teal-soft when active so the
								 * accent stays in the same family as the wordmark
								 * dot and primary CTAs. Neutral when idle so the
								 * rail reads as a quiet list of options.
								 */}
								<span
									className={clsx(
										'grid flex-shrink-0 place-items-center rounded-[8px]',
										'h-7 w-7 md:h-9 md:w-9',
										'transition-[background-color,color] duration-150',
										active
											? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
											: 'bg-transparent text-[var(--color-ink-muted)] group-hover:text-[var(--color-ink)]',
									)}
								>
									<Icon
										className="h-4 w-4 md:h-[17px] md:w-[17px]"
										strokeWidth={1.75}
									/>
								</span>

								{/* Label stack: tool name + (desktop only) hint. */}
								<span
									className={clsx(
										'flex min-w-0 flex-col leading-tight',
										// Mobile: shrink to fit so the icon stays
										// vertically centered above. Desktop: take
										// the remaining row width.
										'items-center md:flex-1 md:items-start',
									)}
								>
									<span className="flex items-center gap-1">
										<span
											className={clsx(
												'font-medium text-[var(--color-ink)]',
												'text-[11px] md:text-[13px]',
											)}
										>
											{label}
										</span>
										{hasResult && (
											<span
												aria-label="Has result"
												title="Has result"
												className="block h-[5px] w-[5px] rounded-full bg-[var(--color-brand)]"
											/>
										)}
									</span>
									{/* Description only on desktop. */}
									<span className="mt-0.5 hidden truncate text-[11.5px] text-[var(--color-ink-muted)] md:block">
										{desc}
									</span>
								</span>

								{/*
								 * Clear-result X. Desktop only — on mobile,
								 * users undo via the header's Undo button (no
								 * room for hover affordances on touch).
								 */}
								{hasResult && (
									<span
										role="button"
										tabIndex={0}
										aria-label={`Clear ${label} result`}
										title={`Clear ${label} result`}
										onClick={(e) => {
											e.stopPropagation();
											onClearResult(id);
										}}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												e.stopPropagation();
												onClearResult(id);
											}
										}}
										className="hit-40 hidden h-7 w-7 flex-shrink-0 place-items-center rounded-md text-[var(--color-ink-subtle)] opacity-0 transition-opacity duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)] group-hover:opacity-100 group-focus-within:opacity-100 md:grid"
									>
										<X className="h-3.5 w-3.5" strokeWidth={2} />
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>

			{/*
			 * Reassurance footer — desktop only. On mobile there's no
			 * room beneath the tab strip without pushing the canvas down,
			 * so the promise lives only here.
			 */}
			<div className="mt-2.5 hidden border-t border-[var(--color-line)] pt-2.5 pb-1 text-center md:block">
				<p className="text-[11px] leading-snug text-[var(--color-ink-subtle)]">
					Free to use
					<span
						aria-hidden
						className="mx-1.5 text-[var(--color-ink-faint)]"
					>
						·
					</span>
					No sign-in
				</p>
				<p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-subtle)]">
					Unlimited transformations
				</p>
			</div>
		</aside>
	);
}
