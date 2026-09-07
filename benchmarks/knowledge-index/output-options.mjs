import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
export const repositoryRoot = path.resolve(path.dirname(modulePath), '../..');

export const OUTPUT_DIR_OPTION = '--output-dir';
export const BENCHMARK_REPORT_ROOT_DEFAULT = path.join(
	repositoryRoot,
	tmpOutputSubdirectory('knowledge-index-reports')
);
export const REPLAY_REPORT_ROOT_DEFAULT = path.join(
	repositoryRoot,
	tmpOutputSubdirectory('index-replay-reports')
);

function tmpOutputSubdirectory(relative) {
	return `tmp/${relative}`;
}

function isEmptyOutput(value) {
	return typeof value !== 'string' || value.trim().length === 0;
}

export function parseOutputDir(argv, defaultOutputDir) {
	let outputDir = defaultOutputDir;
	const remaining = [];

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === OUTPUT_DIR_OPTION) {
			if (isEmptyOutput(next) || /^-/u.test(next)) {
				throw new Error(`${OUTPUT_DIR_OPTION} requires a directory argument.`);
			}
			outputDir = next;
			index += 1;
			continue;
		}
		remaining.push(arg);
	}
	return { outputDir, argv: remaining };
}

export function isGitIgnoredRelative(candidate) {
	const result = spawnSync(
		'git',
		['check-ignore', '-q', '--no-index', path.join(candidate, 'probe', 'summary.json')],
		{
			cwd: repositoryRoot,
			stdio: 'ignore',
			timeout: 5_000,
		}
	);
	return result.status === 0;
}

function isInRepository(candidate) {
	const relative = path.relative(repositoryRoot, candidate);
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}


function isInvalidOutputPath(candidate) {
	if (candidate === repositoryRoot || candidate === path.parse(candidate).root) {
		throw new Error('Output directory cannot be the repository root.');
	}
	if (!isInRepository(candidate) && !path.isAbsolute(candidate)) {
		throw new Error('Output directory must resolve to an absolute path.');
	}
}

function hasTrackedOutputChildren(candidate) {
	if (!isInRepository(candidate)) {
		return false;
	}
	const relative = path.relative(repositoryRoot, candidate);
	const result = spawnSync('git', ['ls-files', '--', `${relative}${path.sep}`], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: 5_000,
	});
	if (result.status !== 0) throw new Error('Cannot verify tracked output paths.');
	return String(result.stdout).trim().length > 0;
}

export function resolveOutputRoot(outputDir) {
	if (isEmptyOutput(outputDir)) {
		throw new Error('Output directory cannot be empty.');
	}
	const candidate = path.resolve(process.cwd(), outputDir);

	if (isEmptyOutput(candidate)) {
		throw new Error('Output directory cannot be empty.');
	}
	isInvalidOutputPath(candidate);

	let stat;
	try {
		stat = fs.lstatSync(candidate);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		stat = null;
	}
	if (stat && !stat.isDirectory()) {
		throw new Error('Output directory must not be a file path.');
	}

	let ancestor = candidate;
	const tail = [];
	while (!fs.existsSync(ancestor)) { tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
	if (!fs.statSync(ancestor).isDirectory()) throw new Error('Output parent must be a directory.');
	const resolved = path.resolve(fs.realpathSync(ancestor), ...tail);
	if (resolved !== candidate && isInRepository(candidate)) throw new Error('Repository output directory must not traverse symlinks.');
	const candidateRelative = path.relative(repositoryRoot, candidate);
	const inRepository = isInRepository(candidate);
	if (inRepository && !isGitIgnoredRelative(candidateRelative)) {
		throw new Error('Output directory must be Git-ignored in repository runs.');
	}
	if (inRepository && hasTrackedOutputChildren(candidate)) {
		throw new Error('Output directory resolves to an unignored repository source path.');
	}
	return candidate;
}
