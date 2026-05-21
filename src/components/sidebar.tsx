import clsx from 'clsx';
import { X } from 'lucide-react';
import type { Tool } from '../types';

interface SidebarProps {
	activeTool: Tool;
	/** True for each tool that currently has a cached result. */
	results: Record<Tool, boolean>;
	onSelectTool: (tool: Tool) => void;
	/** Per-tool X: undo just this tool's transformation. */
	onClearResult: (tool: Tool) => void;
}

const tools: { id: Tool; label: string }[] = [
	{ id: 'background', label: 'Background' },
	{ id: 'expand', label: 'Expand' },
	{ id: 'upscale', label: 'Upscale' },
];

/**
 * Left tool panel.
 *
 *   - The active item gets a soft pill background.
 *   - Any tool that has a cached result gets an X next to its label. Clicking
 *     the X undoes just that tool's transformation (lands in the global undo
 *     stack, so the header's Undo / Redo can step over it later).
 *
 * The X click is stopped from bubbling so the parent row's onClick doesn't
 * re-select what we're trying to clear.
 */
export function Sidebar({ activeTool, results, onSelectTool, onClearResult }: SidebarProps) {
	return (
		<aside
			className="card-floating w-[220px] flex-shrink-0 p-2"
			aria-label="Editor tools"
		>
			<ul className="flex flex-col gap-0.5">
				{tools.map((tool) => {
					const active = tool.id === activeTool;
					const hasResult = results[tool.id];
					return (
						<li key={tool.id}>
							<button
								onClick={() => onSelectTool(tool.id)}
								className={clsx(
									'group flex h-11 w-full items-center justify-between rounded-lg px-3.5 text-left text-[14px]',
									'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
									active
										? 'bg-[var(--color-surface-hover)] font-semibold text-[var(--color-ink)]'
										: 'font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]',
								)}
							>
								<span>{tool.label}</span>
								{hasResult && (
									<span
										role="button"
										tabIndex={0}
										aria-label={`Undo ${tool.label}`}
										title={`Undo ${tool.label}`}
										onClick={(e) => {
											e.stopPropagation();
											onClearResult(tool.id);
										}}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												e.stopPropagation();
												onClearResult(tool.id);
											}
										}}
										className="hit-40 -mr-1 grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-surface-active)] hover:text-[var(--color-ink)]"
									>
										<X className="h-4 w-4" strokeWidth={2} />
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
		</aside>
	);
}
