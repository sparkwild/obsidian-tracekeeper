"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMissingLogFile = exports.logHash = void 0;
exports.assertLogPath = assertLogPath;
exports.readLogFile = readLogFile;
exports.writeLogFile = writeLogFile;
exports.syncLogDirectory = syncLogDirectory;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const logHash = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
exports.logHash = logHash;
const isMissingLogFile = (error) => error?.code === 'ENOENT';
exports.isMissingLogFile = isMissingLogFile;
/** 操作 I/O 前检查受管根路径及其下的现存节点，拒绝符号链接。 */
async function assertLogPath(root, target = root) {
    const relative = node_path_1.default.relative(root, target);
    if (relative === '..' || relative.startsWith('..' + node_path_1.default.sep) || node_path_1.default.isAbsolute(relative))
        throw new Error('Log path escapes its owner.');
    let current = node_path_1.default.resolve(root);
    const components = ['', ...relative.split(node_path_1.default.sep).filter(Boolean)];
    for (const component of components) {
        if (component)
            current = node_path_1.default.join(current, component);
        try {
            if ((await promises_1.default.lstat(current)).isSymbolicLink())
                throw new Error('Symbolic links are not allowed in log storage.');
        }
        catch (error) {
            if ((0, exports.isMissingLogFile)(error))
                break;
            throw error;
        }
    }
}
async function readLogFile(root, file, limit = 192 * 1024 * 1024) {
    await assertLogPath(root, file);
    let handle;
    try {
        handle = await promises_1.default.open(file, 'r');
    }
    catch (error) {
        if ((0, exports.isMissingLogFile)(error))
            return null;
        throw error;
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > limit)
            throw new Error('Invalid or oversized log file.');
        return await handle.readFile('utf8');
    }
    finally {
        await handle.close();
    }
}
/** 原子替换在文件及目录元数据同步后才确认完成。 */
async function writeLogFile(root, file, bytes) {
    await assertLogPath(root, file);
    await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${(0, node_crypto_1.randomBytes)(12).toString('hex')}`;
    const handle = await promises_1.default.open(temporary, 'wx', 0o600);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    }
    catch (error) {
        await promises_1.default.unlink(temporary).catch(() => undefined);
        throw error;
    }
    finally {
        await handle.close();
    }
    try {
        await assertLogPath(root, file);
        await promises_1.default.rename(temporary, file);
        await syncLogDirectory(node_path_1.default.dirname(file));
    }
    finally {
        await promises_1.default.unlink(temporary).catch(() => undefined);
    }
}
async function syncLogDirectory(directory) {
    const handle = await promises_1.default.open(directory, 'r').catch((error) => {
        if (process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES'].includes(error.code))
            return null;
        throw error;
    });
    if (handle)
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
}
