#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ensureVersionCompatibilityBoundary,
	resolveMinimumAppVersion,
} from './version_compatibility.mjs';

test('resolves the latest compatibility boundary at or before the plugin version', () => {
	const versions = {
		'0.3.0': '1.11.0',
		'0.1.0': '1.6.0',
		'0.1.2': '1.8.7',
	};
	assert.equal(resolveMinimumAppVersion(versions, '0.3.2'), '1.11.0');
	assert.equal(resolveMinimumAppVersion(versions, '0.2.3'), '1.8.7');
});

test('does not add a redundant mapping when minAppVersion is unchanged', () => {
	const versions = {
		'0.1.0': '1.6.0',
		'0.3.0': '1.11.0',
	};
	assert.equal(ensureVersionCompatibilityBoundary(versions, '0.3.3', '1.11.0', '0.3.2'), false);
	assert.equal(Object.hasOwn(versions, '0.3.2'), false);
	assert.equal(Object.hasOwn(versions, '0.3.3'), false);
});

test('adds a mapping when minAppVersion changes', () => {
	const versions = {
		'0.1.0': '1.6.0',
		'0.3.0': '1.11.0',
	};
	assert.equal(ensureVersionCompatibilityBoundary(versions, '0.4.0', '1.13.0'), true);
	assert.equal(versions['0.4.0'], '1.13.0');
});

test('keeps the previous published version selectable when raising the compatibility floor', () => {
	const versions = { '0.3.2': '1.11.0', '0.8.0': '1.13.0' };
	assert.equal(ensureVersionCompatibilityBoundary(versions, '0.8.0', '1.13.0', '0.7.1'), true);
	assert.deepEqual(versions, { '0.3.2': '1.11.0', '0.7.1': '1.11.0', '0.8.0': '1.13.0' });
	assert.equal(ensureVersionCompatibilityBoundary(versions, '0.8.0', '1.13.0', '0.7.1'), false);
});

test('rejects malformed compatibility mappings', () => {
	assert.throws(
		() => resolveMinimumAppVersion({ next: '1.11.0' }, '0.3.3'),
		/strict x\.y\.z versioning/
	);
	assert.throws(
		() => ensureVersionCompatibilityBoundary({ '0.3.0': '1.11.0' }, '0.3.3', 'latest'),
		/strict x\.y\.z versioning/
	);
	assert.throws(
		() => resolveMinimumAppVersion({ '0.3.0': 1.11 }, '0.3.3'),
		/strict x\.y\.z versioning/
	);
});
