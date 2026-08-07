"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcError = void 0;
exports.isRecord = isRecord;
class RpcError extends Error {
    constructor({ code, message, data }) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.data = data;
    }
}
exports.RpcError = RpcError;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
