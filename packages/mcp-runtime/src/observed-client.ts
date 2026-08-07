export type ObservedClientType =
	| 'codex'
	| 'claude-code'
	| 'claude-desktop'
	| 'cursor'
	| 'gemini'
	| 'grok'
	| 'zcode'
	| 'custom'
	| 'unknown';

export function normalizeObservedClientType(clientName: string | null | undefined): ObservedClientType {
	const normalized = (clientName || '').trim().toLowerCase();
	if (!normalized) {
		return 'unknown';
	}
	if (normalized.includes('codex')) {
		return 'codex';
	}
	if (
		normalized === 'gemini-cli-mcp-client'
		|| normalized.includes('gemini cli')
		|| normalized.includes('gemini-cli')
		|| normalized.includes('gemini_cli')
	) {
		return 'gemini';
	}
	if (
		normalized === 'grok'
		|| normalized.startsWith('grok-shell-')
		|| normalized.includes('grok build')
		|| normalized.includes('grok-build')
		|| normalized.includes('grok_build')
	) {
		return 'grok';
	}
	if (normalized === 'zcode' || normalized.includes('zcode')) {
		return 'zcode';
	}
	if (
		normalized.includes('claude desktop')
		|| normalized.includes('claude-desktop')
		|| normalized.includes('claude_desktop')
	) {
		return 'claude-desktop';
	}
	if (
		normalized === 'claude'
		|| normalized.includes('claude code')
		|| normalized.includes('claude-code')
		|| normalized.includes('claude_code')
	) {
		return 'claude-code';
	}
	if (normalized.includes('cursor')) {
		return 'cursor';
	}
	return 'custom';
}
