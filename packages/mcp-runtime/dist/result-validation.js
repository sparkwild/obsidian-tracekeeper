"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStructuredContent = validateStructuredContent;
const protocol_1 = require("./protocol");
function matchesType(value, expected) {
    const types = Array.isArray(expected) ? expected : [expected];
    return types.some((type) => {
        switch (type) {
            case 'object':
                return (0, protocol_1.isRecord)(value);
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
function validateNode(value, schema, path, errors) {
    if (!(0, protocol_1.isRecord)(schema)) {
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
            const candidateErrors = [];
            validateNode(value, child, path, candidateErrors);
            return candidateErrors;
        });
        const matchingBranches = branchErrors.filter((candidateErrors) => candidateErrors.length === 0).length;
        if (matchingBranches !== 1) {
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
    if (!(0, protocol_1.isRecord)(value)) {
        return;
    }
    const required = Array.isArray(schema.required)
        ? schema.required.filter((entry) => typeof entry === 'string')
        : [];
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            errors.push(`${path}.${key} is required`);
        }
    }
    const properties = (0, protocol_1.isRecord)(schema.properties) ? schema.properties : {};
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
function validateStructuredContent(value, schema) {
    const errors = [];
    validateNode(value, schema, '$', errors);
    return {
        valid: errors.length === 0,
        errors,
    };
}
