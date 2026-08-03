import { isRecord } from './protocol';

export interface SchemaValidationResult {
	valid: boolean;
	errors: string[];
}

function matchesType(value: unknown, expected: unknown): boolean {
	const types = Array.isArray(expected) ? expected : [expected];
	return types.some((type) => {
		switch (type) {
			case 'object':
				return isRecord(value);
			case 'array':
				return Array.isArray(value);
			case 'string':
				return typeof value === 'string';
			case 'boolean':
				return typeof value === 'boolean';
			case 'integer':
				return Number.isInteger(value);
			case 'number':
				return typeof value === 'number' && Number.isFinite(value);
			case 'null':
				return value === null;
			default:
				return false;
		}
	});
}

function validateNode(value: unknown, schema: unknown, path: string, errors: string[]): void {
	if (!isRecord(schema)) {
		return;
	}

	if ('const' in schema && !Object.is(value, schema.const)) {
		errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
		errors.push(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
	}
	if (schema.type !== undefined && !matchesType(value, schema.type)) {
		errors.push(`${path} must have type ${Array.isArray(schema.type) ? schema.type.join('|') : String(schema.type)}`);
		return;
	}

	if (Array.isArray(schema.allOf)) {
		for (const child of schema.allOf) {
			validateNode(value, child, path, errors);
		}
	}
	if (Array.isArray(schema.oneOf)) {
		const branchErrors = schema.oneOf.map((child) => {
			const candidateErrors: string[] = [];
			validateNode(value, child, path, candidateErrors);
			return candidateErrors;
		});
		const matchingBranches = branchErrors.filter((candidateErrors) => candidateErrors.length === 0).length;
		if (matchingBranches !== 1) {
			for (const [branchIndex, candidateErrors] of branchErrors.entries()) {
				for (const branchError of candidateErrors.slice(0, 3)) {
					errors.push(`${path} oneOf[${branchIndex}]: ${branchError}`);
				}
			}
			errors.push(`${path} must match exactly one schema branch`);
		}
	}

	if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength) {
		errors.push(`${path} must contain at least ${schema.minLength} characters`);
	}
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			errors.push(`${path} must be at least ${schema.minimum}`);
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			errors.push(`${path} must be at most ${schema.maximum}`);
		}
	}

	if (Array.isArray(value) && schema.items !== undefined) {
		value.forEach((entry, index) => validateNode(entry, schema.items, `${path}[${index}]`, errors));
	}
	if (!isRecord(value)) {
		return;
	}

	const required = Array.isArray(schema.required)
		? schema.required.filter((entry): entry is string => typeof entry === 'string')
		: [];
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			errors.push(`${path}.${key} is required`);
		}
	}

	const properties = isRecord(schema.properties) ? schema.properties : {};
	for (const [key, childSchema] of Object.entries(properties)) {
		if (Object.prototype.hasOwnProperty.call(value, key)) {
			validateNode(value[key], childSchema, `${path}.${key}`, errors);
		}
	}
	if (schema.additionalProperties === false) {
		for (const key of Object.keys(value)) {
			if (!(key in properties)) {
				errors.push(`${path}.${key} is not allowed`);
			}
		}
	}
}

export function validateStructuredContent(value: unknown, schema: unknown): SchemaValidationResult {
	const errors: string[] = [];
	validateNode(value, schema, '$', errors);
	return {
		valid: errors.length === 0,
		errors,
	};
}
