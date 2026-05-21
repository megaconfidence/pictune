import clsx from 'clsx';
import { X } from 'lucide-react';
import type { Tool } from '../types';

interface SidebarProps {
	activeTool: Tool;
	onSelectTool: (tool: Tool) => void;
	onClearTool: () => void;
}

const tools: { id: Tool; label: string }[] = [
	{ id: 'background', label: 'Background' },
	{ id: 'expand', label: 'Expand' },
	{ id: 'upscale', label: 'Upscale' },
];

/**
 * Left tool panel. The active item gets a soft pill background and an X to
 * deselect (matches the design's behaviour on Background / Upscale).
 *
 * The X click is stopped from bubbling so the parent row's onClick doesn't
 * re-select what we just cleared.
 */
export function Sidebar({ activeTool, onSelectTool, onClearTool }: SidebarProps) {
	return (
		<aside
			className="card-floating w-[220px] flex-shrink-0 p-2"
			aria-label="Editor tools"
		>
			<ul className="flex flex-col gap-0.5">
				{tools.map((tool) => {
					const active = tool.id === activeTool;
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
								{active && (
									<span
										role="button"
										tabIndex={0}
										aria-label={`Deselect ${tool.label}`}
										onClick={(e) => {
											e.stopPropagation();
											onClearTool();
										}}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												e.stopPropagation();
												onClearTool();
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
