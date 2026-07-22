export interface SchemaValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateStructuredContent(value: unknown, schema: unknown): SchemaValidationResult;
