export interface SkillDirectorySelection {
	selectedDirectory: string;
	targetDirectory: string;
}

export function normalizeSkillDirectorySelection(
	selectedDirectory: string,
	joinPath: (...parts: string[]) => string
): SkillDirectorySelection {
	const normalized = selectedDirectory.trim();
	if (!isAbsoluteDirectory(normalized)) {
		throw new Error('Skill directory must be an absolute path.');
	}
	if (normalized.includes('\0')) {
		throw new Error('Skill directory contains an invalid NUL character.');
	}
	const segments = normalized.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
	if (segments.includes('..')) {
		throw new Error('Skill directory cannot contain path traversal segments.');
	}
	const finalSegment = segments.at(-1) ?? '';
	const withoutTrailingSeparators = normalized.replace(/[\\/]+$/, '');
	const selectedRoot = /^[A-Za-z]:$/.test(withoutTrailingSeparators) && /^[A-Za-z]:[\\/]/.test(normalized)
		? normalized.slice(0, 3)
		: withoutTrailingSeparators || normalized[0];
	const targetDirectory = finalSegment === 'tracekeeper'
		? selectedRoot
		: joinPath(selectedRoot, 'tracekeeper');
	if (!isAbsoluteDirectory(targetDirectory) || targetDirectory.includes('\0')) {
		throw new Error('Skill target directory is invalid.');
	}
	return {
		selectedDirectory: selectedRoot,
		targetDirectory,
	};
}

export function isAbsoluteDirectory(value: string): boolean {
	return value !== ''
		&& !value.includes('\0')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));
}

export function sameSkillTargetDirectory(left: string, right: string): boolean {
	const normalize = (value: string): string => {
		const normalized = value.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/');
		return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
	};
	return normalize(left) === normalize(right);
}
