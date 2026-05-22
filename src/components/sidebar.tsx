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
 * Left tool rail. Minimal: a row per tool, no decoration besides the
 * background tone that marks the active item.
 *
 *   - Active row: teal-tinted icon tile on a soft-gray row background.
 *     One quiet color signal per row — the same teal that appears in the
 *     wordmark dot and on primary CTAs, so the eye reads "selected"
 *     without anything shouting for attention.
 *   - Clear-X reveals on hover when there's a result; click clears just
 *     that tool's result (lands in the global undo stack so Cmd+Z can
 *     step over it later).
 *   - Bottom of the card holds a quiet reassurance line ("Free to use ·
 *     No sign-in / Unlimited transformations"). Lives here instead of
 *     the drop zone so it stays visible after the user uploads — the
 *     promise should reassure them throughout the session, not vanish
 *     the moment they engage.
 *
 * The X is stopped from bubbling so the parent row's onClick doesn't
 * re-select what we're trying to clear.
 */
export function Sidebar({ activeTool, results, onSelectTool, onClearResult }: SidebarProps) {
	return (
		<aside
			className="card-floating w-[220px] flex-shrink-0 p-2.5 animate-rise"
			style={{ animationDelay: '80ms' }}
			aria-label="Editor tools"
		>
			<ul className="flex flex-col gap-0.5">
				{TOOLS.map(({ id, label, desc, Icon }) => {
					const active = id === activeTool;
					const hasResult = results[id];
					return (
						<li key={id}>
							<button
								onClick={() => onSelectTool(id)}
								aria-pressed={active}
								className={clsx(
									// p-2.5 (10px) outer → rounded-[10px] inner = concentric.
									'group relative flex h-[56px] w-full items-center gap-3 rounded-[10px] pl-2 pr-2 text-left',
									'transition-[background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]',
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
										'grid h-9 w-9 flex-shrink-0 place-items-center rounded-[8px]',
										'transition-[background-color,color] duration-150',
										active
											? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
											: 'bg-transparent text-[var(--color-ink-muted)] group-hover:text-[var(--color-ink)]',
									)}
								>
									<Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
								</span>

								{/* Label stack: tool name + one-line hint. */}
								<span className="flex min-w-0 flex-1 flex-col leading-tight">
									<span className="flex items-center gap-1.5">
										<span className="text-[13px] font-medium text-[var(--color-ink)]">
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
									<span className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink-muted)]">
										{desc}
									</span>
								</span>

								{/* Clear-result X. Only when this tool has a result. */}
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
										className="hit-40 grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-[var(--color-ink-subtle)] opacity-0 transition-opacity duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)] group-hover:opacity-100 group-focus-within:opacity-100"
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
			 * Reassurance footer. Hairline separates it from the action
			 * list above so the eye reads "actions / meta". Two-line
			 * layout chosen so each phrase stays intact in the narrow
			 * 220px rail rather than wrapping mid-word.
			 */}
			<div className="mt-2.5 border-t border-[var(--color-line)] pt-2.5 pb-1 text-center">
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
