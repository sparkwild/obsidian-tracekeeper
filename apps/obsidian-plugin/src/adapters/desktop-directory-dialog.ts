export interface DesktopDirectoryDialog {
	showOpenDialog(options: { properties: readonly string[] }): Promise<{
		canceled: boolean;
		filePaths: string[];
	}>;
}

export function resolveDesktopDirectoryDialog(
	electronModule: unknown,
	electronRemoteModule: unknown
): DesktopDirectoryDialog | undefined {
	const electron = asRecord(electronModule);
	const remote = asRecord(electronRemoteModule);
	const legacyRemote = asRecord(electron?.remote);
	for (const candidate of [electron?.dialog, remote?.dialog, legacyRemote?.dialog]) {
		if (isDesktopDirectoryDialog(candidate)) return candidate;
	}
	return undefined;
}

function isDesktopDirectoryDialog(value: unknown): value is DesktopDirectoryDialog {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& typeof (value as Record<string, unknown>).showOpenDialog === 'function';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
