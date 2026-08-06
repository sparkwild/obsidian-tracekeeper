"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultRecordAdapter = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const core_1 = require("@tracekeeper/core");
const audit_persistence_1 = require("./audit-persistence");
const safety_1 = require("../safety");
function pathOptions(context) {
    return { vaultConfigDir: context.vaultConfigDir };
}
function stripYamlQuotes(value) {
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
}
function frontmatterString(frontmatter, keys) {
    for (const key of keys) {
        const value = frontmatter[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
    }
    return '';
}
class VaultRecordAdapter {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}, operationId = '') {
        const options = pathOptions(context);
        const safeLeaf = (0, safety_1.normalizeNotePath)(filename, options);
        const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
        const targetPath = `${allowedDir}/${normalized}`;
        const resolved = (0, safety_1.resolveSafeWritableNotePath)(vaultRoot, targetPath, allowedDir, options);
        fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
        if (fs.existsSync(resolved.absolutePath)) {
            throw new safety_1.ToolInputError(`Target already exists: ${resolved.relativePath}`);
        }
        const markdown = this.dependencies.buildMarkdownNote(frontmatter, body);
        fs.writeFileSync(resolved.absolutePath, markdown, 'utf8');
        const audit = (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
            operationId,
            tool: toolName,
            targetPath: resolved.relativePath,
            status: 'written',
            taskId,
            metadata,
        });
        return {
            path: resolved.relativePath,
            activity_path: audit.path,
            status: 'written',
            warnings: [],
        };
    }
    async buildAndWriteNoteAsync(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}, operationId = '') {
        const options = pathOptions(context);
        const safeLeaf = (0, safety_1.normalizeNotePath)(filename, options);
        const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
        const targetPath = `${allowedDir}/${normalized}`;
        const markdown = this.dependencies.buildMarkdownNote(frontmatter, body);
        if (!context.vaultRepository) {
            return this.buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata, operationId);
        }
        try {
            await context.vaultRepository.createText(targetPath, markdown);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('Target already exists')) {
                throw new safety_1.ToolInputError(`Target already exists: ${targetPath}`);
            }
            throw error;
        }
        const audit = await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
            operationId,
            tool: toolName,
            targetPath,
            status: 'written',
            taskId,
            metadata,
        }, context);
        return {
            path: targetPath,
            activity_path: audit.path,
            status: 'written',
            warnings: [],
        };
    }
    findOperationOwnedNote(vaultRoot, allowedDir, filename, operationField, operationId, context) {
        const safeLeaf = (0, safety_1.normalizeNotePath)(filename, pathOptions(context));
        const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
        const relativePath = `${allowedDir}/${normalized}`;
        const absolutePath = path.resolve(vaultRoot, relativePath);
        (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
        (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolutePath);
        if (!fs.existsSync(absolutePath)) {
            return null;
        }
        const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
        const existingOperationId = stripYamlQuotes(frontmatterString(parsed.frontmatter.fields, [operationField]));
        if (existingOperationId !== operationId) {
            throw new core_1.OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
        }
        return {
            path: relativePath,
            activity_path: this.dependencies.agentActivityPath,
            status: 'skipped',
            warnings: [],
        };
    }
    async findOperationOwnedNoteAsync(vaultRoot, allowedDir, filename, operationField, operationId, context) {
        const safeLeaf = (0, safety_1.normalizeNotePath)(filename, pathOptions(context));
        const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
        const relativePath = `${allowedDir}/${normalized}`;
        if (context.vaultRepository) {
            const repositoryFile = await context.vaultRepository.readText(relativePath);
            if (!repositoryFile) {
                return null;
            }
            const parsed = (0, core_1.parseMarkdown)(repositoryFile.content);
            const existingOperationId = stripYamlQuotes(frontmatterString(parsed.frontmatter.fields, [operationField]));
            if (existingOperationId !== operationId) {
                throw new core_1.OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
            }
            return {
                path: relativePath,
                activity_path: this.dependencies.agentActivityPath,
                status: 'skipped',
                warnings: [],
            };
        }
        return this.findOperationOwnedNote(vaultRoot, allowedDir, filename, operationField, operationId, context);
    }
}
exports.VaultRecordAdapter = VaultRecordAdapter;
