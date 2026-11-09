const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStrictVersion(version, label) {
	if (typeof version !== 'string' || !STRICT_VERSION_PATTERN.test(version)) {
		throw new Error(`${label} must use strict x.y.z versioning.`);
	}
	return version.split('.').map((part) => BigInt(part));
}

export function compareStrictVersions(left, right) {
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

export function ensureVersionCompatibilityBoundary(versions, pluginVersion, minAppVersion, previousVersion) {
	parseStrictVersion(minAppVersion, 'Minimum Obsidian version');
	const currentMinimum = resolveMinimumAppVersion(versions, pluginVersion);
	let changed = false;
	if (previousVersion && compareStrictVersions(previousVersion, pluginVersion) < 0) {
		const previousMinimum = resolveMinimumAppVersion(versions, previousVersion);
		if (previousMinimum && compareStrictVersions(previousMinimum, minAppVersion) < 0 && !Object.hasOwn(versions, previousVersion)) {
			versions[previousVersion] = previousMinimum;
			changed = true;
		}
	}
	if (currentMinimum !== minAppVersion) {
		versions[pluginVersion] = minAppVersion;
		changed = true;
	}
	return changed;
}
