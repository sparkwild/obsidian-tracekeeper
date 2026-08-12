const STRICT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function parseStrictVersion(version, label) {
	if (typeof version !== 'string' || !STRICT_VERSION_PATTERN.test(version)) {
		throw new Error(`${label} must use strict x.y.z versioning.`);
	}
	return version.split('.').map((part) => BigInt(part));
}

function compareStrictVersions(left, right) {
	const leftParts = parseStrictVersion(left, `Version ${left}`);
	const rightParts = parseStrictVersion(right, `Version ${right}`);
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] < rightParts[index]) {
			return -1;
		}
		if (leftParts[index] > rightParts[index]) {
			return 1;
		}
	}
	return 0;
}

export function resolveMinimumAppVersion(versions, pluginVersion) {
	parseStrictVersion(pluginVersion, 'Plugin version');
	const compatibleMappings = Object.entries(versions)
		.map(([version, minAppVersion]) => {
			parseStrictVersion(version, `versions.json key ${version}`);
			parseStrictVersion(minAppVersion, `versions.json value for ${version}`);
			return [version, minAppVersion];
		})
		.filter(([version]) => compareStrictVersions(version, pluginVersion) <= 0)
		.sort(([left], [right]) => compareStrictVersions(left, right));
	return compatibleMappings.at(-1)?.[1];
}

export function ensureVersionCompatibilityBoundary(versions, pluginVersion, minAppVersion) {
	parseStrictVersion(minAppVersion, 'Minimum Obsidian version');
	if (resolveMinimumAppVersion(versions, pluginVersion) === minAppVersion) {
		return false;
	}
	versions[pluginVersion] = minAppVersion;
	return true;
}
