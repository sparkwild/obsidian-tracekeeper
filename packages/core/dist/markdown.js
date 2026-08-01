"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFrontmatter = parseFrontmatter;
exports.extractWikilinks = extractWikilinks;
exports.extractHeadings = extractHeadings;
exports.extractTags = extractTags;
exports.extractBlockIds = extractBlockIds;
exports.parseMarkdown = parseMarkdown;
const yaml_1 = require("yaml");
const FRONTMATTER_PATTERN = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const BLOCK_ID_PATTERN = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/;
const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const CALLOUT_HEADER_PATTERN = /^\s*>\s*\[!([^\]]+)\]([+-]?)(?:[ \t]+.*)?$/i;
const EXTERNAL_LINK = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/;
const TAG_PATTERN = /(^|[^\p{L}\p{M}\p{N}_])#([\p{L}\p{M}\p{N}_/-]+)/gu;
function parseFrontmatter(rawContent) {
    const normalized = rawContent.replace(/\r\n?/g, '\n');
    const match = normalized.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {
            fields: {},
            raw: '',
            body: normalized,
            errors: [],
            bodyOffset: 0,
            bodyStartLine: 1,
        };
    }
    const frontmatterRaw = match[1] ?? '';
    const matchedText = match[0] ?? '';
    const bodyOffset = matchedText.length;
    const parsed = parseFrontmatterBody(frontmatterRaw);
    return {
        fields: parsed.fields,
        raw: frontmatterRaw,
        body: normalized.slice(bodyOffset),
        errors: parsed.errors,
        bodyOffset,
        bodyStartLine: countLines(matchedText) + 1,
    };
}
function extractWikilinks(content) {
    const normalized = content.replace(/\r\n?/g, '\n');
    const semantic = buildSemanticBody(normalized);
    return extractInternalLinks(semantic.masked, {
        source: 'body',
        baseOffset: 0,
        fullText: normalized,
    });
}
function extractHeadings(content) {
    const normalized = content.replace(/\r\n?/g, '\n');
    const semantic = buildSemanticBody(normalized);
    return collectHeadings(semantic.masked).map((heading) => heading.text);
}
function extractTags(frontmatter, content) {
    const normalized = content.replace(/\r\n?/g, '\n');
    const semantic = buildSemanticBody(normalized);
    const linkRanges = extractInternalLinks(semantic.masked).map((edge) => ({
        start: edge.position.start.offset,
        end: edge.position.end.offset,
    }));
    const tagInput = maskContent(semantic.masked, linkRanges);
    const tags = new Set();
    for (const tag of readFrontmatterTags(frontmatter.tags)) {
        if (isValidTag(tag)) {
            tags.add(normalizeTag(tag));
        }
    }
    TAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = TAG_PATTERN.exec(tagInput)) !== null) {
        const tag = match[2] ?? '';
        if (isValidTag(tag)) {
            tags.add(normalizeTag(tag));
        }
    }
    return [...tags];
}
function extractBlockIds(content) {
    const normalized = content.replace(/\r\n?/g, '\n');
    const semantic = buildSemanticBody(normalized);
    const ids = new Set();
    for (const line of semantic.masked.split('\n')) {
        const match = line.match(BLOCK_ID_PATTERN);
        if (match?.[1]) {
            ids.add(match[1]);
        }
    }
    return [...ids];
}
function parseMarkdown(rawContent) {
    const normalized = rawContent.replace(/\r\n?/g, '\n');
    const frontmatter = parseFrontmatter(normalized);
    const semantic = buildSemanticBody(frontmatter.body);
    const fullText = normalized;
    const headingsWithPositions = collectHeadings(semantic.masked);
    const headings = headingsWithPositions.map((heading) => heading.text);
    const bodyEdges = extractInternalLinks(semantic.masked, {
        source: 'body',
        baseOffset: frontmatter.bodyOffset,
        fullText,
    });
    const frontmatterEdges = extractFrontmatterLinks(frontmatter, fullText);
    const edges = [...frontmatterEdges, ...bodyEdges].sort(compareEdges);
    const blockIds = extractBlockIds(frontmatter.body);
    const callouts = extractCalloutBlocks(frontmatter.body, semantic.masked, frontmatter.bodyOffset, fullText);
    const claimBlocks = callouts.filter((callout) => callout.type.toLowerCase() === 'claim');
    const evidenceBlocks = callouts.filter((callout) => callout.type.toLowerCase() === 'evidence');
    const frontmatterTitle = typeof frontmatter.fields.title === 'string' ? frontmatter.fields.title : '';
    const tags = extractTags(frontmatter.fields, frontmatter.body);
    const sections = buildSections(frontmatter, semantic, headingsWithPositions, callouts, fullText);
    const searchBody = collapseMaskedText(semantic.masked);
    const searchText = [frontmatterTitle, ...tags, ...headings, searchBody].filter(Boolean).join('\n');
    return {
        frontmatter,
        title: frontmatterTitle,
        body: frontmatter.body,
        tags,
        headings,
        blockIds,
        wikilinks: edges,
        edges,
        sections,
        callouts,
        claimBlocks,
        evidenceBlocks,
        searchText,
    };
}
function parseFrontmatterBody(frontmatterRaw) {
    const document = (0, yaml_1.parseDocument)(frontmatterRaw, {
        logLevel: 'silent',
        prettyErrors: false,
        strict: true,
        uniqueKeys: true,
    });
    const errors = [...document.errors, ...document.warnings].map((error) => error.message);
    if (document.errors.length > 0) {
        return { fields: {}, errors };
    }
    try {
        const value = document.toJS({ mapAsMap: false, maxAliasCount: 100 });
        if (value === null || value === undefined) {
            return { fields: {}, errors };
        }
        if (!isPlainRecord(value)) {
            return {
                fields: {},
                errors: [...errors, 'Frontmatter root must be a mapping.'],
            };
        }
        return {
            fields: sanitizeYamlRecord(value),
            errors,
        };
    }
    catch (error) {
        return {
            fields: {},
            errors: [...errors, error instanceof Error ? error.message : String(error)],
        };
    }
}
function sanitizeYamlRecord(value) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
            continue;
        }
        result[key] = sanitizeYamlValue(item, 0);
    }
    return result;
}
function sanitizeYamlValue(value, depth) {
    if (depth >= 32) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeYamlValue(item, depth + 1));
    }
    if (isPlainRecord(value)) {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                continue;
            }
            result[key] = sanitizeYamlValue(item, depth + 1);
        }
        return result;
    }
    if (value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') {
        return value;
    }
    return String(value);
}
function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function buildSemanticBody(content) {
    const ranges = [];
    ranges.push(...findFencedCodeRanges(content));
    ranges.push(...findPatternRanges(content, /<!--[\s\S]*?(?:-->|$)/g, 'html-comment'));
    let masked = maskContent(content, ranges);
    ranges.push(...findPatternRanges(masked, /(`+)([\s\S]*?)\1/g, 'inline-code'));
    masked = maskContent(content, ranges);
    ranges.push(...findPatternRanges(masked, /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+|\b(?:mailto|tel|data):[^\s<>"']+/gi, 'url'));
    return {
        masked: maskContent(content, ranges),
        ranges: ranges.sort((left, right) => left.start - right.start || left.end - right.end),
    };
}
function findFencedCodeRanges(content) {
    const ranges = [];
    const lines = content.split('\n');
    let offset = 0;
    let open;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const hasNewline = index < lines.length - 1;
        const lineEnd = offset + line.length + (hasNewline ? 1 : 0);
        if (!open) {
            const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
            if (match?.[1]) {
                open = {
                    character: match[1][0],
                    length: match[1].length,
                    start: offset,
                };
            }
        }
        else {
            const closing = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
            if (closing?.[1] &&
                closing[1][0] === open.character &&
                closing[1].length >= open.length) {
                ranges.push({
                    type: 'fenced-code',
                    start: open.start,
                    end: lineEnd,
                });
                open = undefined;
            }
        }
        offset = lineEnd;
    }
    if (open) {
        ranges.push({
            type: 'fenced-code',
            start: open.start,
            end: content.length,
        });
    }
    return ranges;
}
function findPatternRanges(content, pattern, type) {
    const ranges = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        ranges.push({
            type,
            start: match.index,
            end: match.index + match[0].length,
        });
        if (match[0].length === 0) {
            pattern.lastIndex += 1;
        }
    }
    return ranges;
}
function maskContent(content, ranges) {
    if (ranges.length === 0) {
        return content;
    }
    const characters = content.split('');
    for (const range of ranges) {
        const start = Math.max(0, range.start);
        const end = Math.min(characters.length, range.end);
        for (let index = start; index < end; index += 1) {
            if (characters[index] !== '\n') {
                characters[index] = ' ';
            }
        }
    }
    return characters.join('');
}
function collectHeadings(content) {
    const headings = [];
    const lines = content.split('\n');
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const match = line.match(HEADING_PATTERN);
        if (match?.[2]) {
            headings.push({
                text: match[2].trim(),
                start: offset,
                end: offset + line.length,
            });
        }
        offset += line.length + (index < lines.length - 1 ? 1 : 0);
    }
    return headings;
}
function extractInternalLinks(content, options = {}) {
    const source = options.source ?? 'body';
    const baseOffset = options.baseOffset ?? 0;
    const fullText = options.fullText ?? content;
    const occupied = new Uint8Array(content.length);
    const fullTextLineOffsets = lineStartOffsets(fullText);
    const links = [];
    const definitions = readReferenceDefinitions(content);
    const addLink = (start, end, raw, targetExpression, displayText, kind) => {
        if (!claimUnoccupiedRange(start, end, occupied)) {
            return;
        }
        const parsedTarget = parseLinkTarget(targetExpression);
        if (!parsedTarget || EXTERNAL_LINK.test(parsedTarget.linkPath)) {
            releaseRange(start, end, occupied);
            return;
        }
        const absoluteStart = baseOffset + start;
        const absoluteEnd = baseOffset + end;
        const position = sourceRangeFromLineOffsets(fullText, fullTextLineOffsets, absoluteStart, absoluteEnd);
        const actualKind = options.kind ?? kind;
        links.push({
            kind: actualKind,
            source,
            raw,
            target: parsedTarget.linkPath,
            linkPath: parsedTarget.linkPath,
            displayText,
            alias: displayText,
            heading: parsedTarget.subpath,
            subpath: parsedTarget.subpath,
            subpathKind: parsedTarget.subpathKind,
            line: position.start.line,
            position,
            resolution: {
                status: 'unresolved',
                reason: parsedTarget.linkPath || parsedTarget.subpath ? 'not_found' : 'empty_target',
                authority: 'fallback',
            },
        });
    };
    const addMissingReference = (start, end, raw, displayText, referenceLabel, kind) => {
        if (!claimUnoccupiedRange(start, end, occupied)) {
            return;
        }
        const position = sourceRangeFromLineOffsets(fullText, fullTextLineOffsets, baseOffset + start, baseOffset + end);
        links.push({
            kind: options.kind ?? kind,
            source,
            raw,
            target: '',
            linkPath: '',
            displayText,
            alias: displayText,
            referenceLabel,
            line: position.start.line,
            position,
            resolution: {
                status: 'unresolved',
                reason: 'missing_reference_definition',
                authority: 'fallback',
            },
        });
    };
    const wikilinkPattern = /(!)?\[\[([^\]\n]+)\]\]/g;
    let match;
    while ((match = wikilinkPattern.exec(content)) !== null) {
        const expression = (match[2] ?? '').trim();
        const separator = expression.indexOf('|');
        const target = (separator >= 0 ? expression.slice(0, separator) : expression).trim();
        const display = separator >= 0 ? expression.slice(separator + 1).trim() : undefined;
        addLink(match.index, match.index + match[0].length, match[0], target, display || undefined, match[1] ? 'embed' : 'link');
    }
    const markdownLinkPattern = /(!)?\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;
    while ((match = markdownLinkPattern.exec(content)) !== null) {
        const destination = readMarkdownDestination(match[3] ?? '');
        if (!destination) {
            continue;
        }
        addLink(match.index, match.index + match[0].length, match[0], destination, (match[2] ?? '').trim() || undefined, match[1] ? 'embed' : 'link');
    }
    const referenceLinkPattern = /(!)?\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
    while ((match = referenceLinkPattern.exec(content)) !== null) {
        const label = ((match[3] ?? '').trim() || (match[2] ?? '').trim()).toLocaleLowerCase('en-US');
        const destination = definitions.get(label);
        if (!destination) {
            addMissingReference(match.index, match.index + match[0].length, match[0], (match[2] ?? '').trim(), label, match[1] ? 'embed' : 'reference');
            continue;
        }
        addLink(match.index, match.index + match[0].length, match[0], destination, (match[2] ?? '').trim() || undefined, match[1] ? 'embed' : 'reference');
    }
    return links.sort(compareEdges);
}
function extractFrontmatterLinks(frontmatter, fullText) {
    if (!frontmatter.raw) {
        return [];
    }
    const strings = [];
    collectStringValues(frontmatter.fields, strings);
    const links = [];
    let searchOffset = 0;
    const frontmatterOffset = Math.max(0, fullText.indexOf(frontmatter.raw));
    const fullTextLineOffsets = lineStartOffsets(fullText);
    for (const value of strings) {
        const semantic = buildSemanticBody(value);
        const parsed = extractInternalLinks(semantic.masked, {
            source: 'frontmatter',
            kind: 'frontmatter',
            baseOffset: 0,
            fullText: value,
        });
        for (const edge of parsed) {
            const relativeOffset = frontmatter.raw.indexOf(edge.raw, searchOffset);
            const fallbackOffset = frontmatter.raw.indexOf(edge.raw);
            const rawOffset = relativeOffset >= 0 ? relativeOffset : fallbackOffset;
            const absoluteStart = rawOffset >= 0 ? frontmatterOffset + rawOffset : frontmatterOffset;
            const absoluteEnd = absoluteStart + edge.raw.length;
            const position = sourceRangeFromLineOffsets(fullText, fullTextLineOffsets, absoluteStart, absoluteEnd);
            links.push({
                ...edge,
                line: position.start.line,
                position,
            });
            if (rawOffset >= 0) {
                searchOffset = rawOffset + edge.raw.length;
            }
        }
    }
    return links.sort(compareEdges);
}
function readReferenceDefinitions(content) {
    const definitions = new Map();
    const pattern = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|\S+)/gm;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const label = (match[1] ?? '').trim().toLocaleLowerCase('en-US');
        const destination = readMarkdownDestination(match[2] ?? '');
        if (label && destination && !EXTERNAL_LINK.test(destination)) {
            definitions.set(label, destination);
        }
    }
    return definitions;
}
function readMarkdownDestination(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith('<')) {
        const closing = trimmed.indexOf('>');
        return closing > 0 ? trimmed.slice(1, closing).trim() : '';
    }
    return trimmed.match(/^\S+/)?.[0] ?? '';
}
function parseLinkTarget(value) {
    const trimmed = value.trim().replace(/^<|>$/g, '');
    if (!trimmed || EXTERNAL_LINK.test(trimmed)) {
        return null;
    }
    const hashIndex = trimmed.indexOf('#');
    const linkPath = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).trim();
    const subpath = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() : undefined;
    return {
        linkPath,
        subpath: subpath || undefined,
        subpathKind: subpath ? (subpath.startsWith('^') ? 'block' : 'heading') : undefined,
    };
}
function extractCalloutBlocks(content, maskedContent, baseOffset, fullText) {
    const rawLines = content.split('\n');
    const maskedLines = maskedContent.split('\n');
    const lineOffsets = lineStartOffsets(content);
    const results = [];
    let lineIndex = 0;
    while (lineIndex < maskedLines.length) {
        const headerMatch = (maskedLines[lineIndex] ?? '').match(CALLOUT_HEADER_PATTERN);
        if (!headerMatch?.[1]) {
            lineIndex += 1;
            continue;
        }
        const startIndex = lineIndex;
        const blockLines = [rawLines[lineIndex] ?? ''];
        lineIndex += 1;
        while (lineIndex < maskedLines.length) {
            const currentMasked = maskedLines[lineIndex] ?? '';
            if (!currentMasked.trim().startsWith('>') || CALLOUT_HEADER_PATTERN.test(currentMasked)) {
                break;
            }
            blockLines.push(rawLines[lineIndex] ?? '');
            lineIndex += 1;
        }
        let blockId;
        const blockIdMatch = (maskedLines[lineIndex] ?? '').match(/^\s*\^([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/);
        if (blockIdMatch?.[1]) {
            blockId = blockIdMatch[1];
            lineIndex += 1;
        }
        const endIndex = Math.max(startIndex, lineIndex - 1);
        const relativeStart = lineOffsets[startIndex] ?? 0;
        const endLine = rawLines[endIndex] ?? '';
        const relativeEnd = (lineOffsets[endIndex] ?? relativeStart) + endLine.length;
        const position = sourceRange(fullText, baseOffset + relativeStart, baseOffset + relativeEnd);
        const contentText = blockLines
            .map((line) => line.replace(/^\s*>\s?/, ''))
            .join('\n')
            .trim();
        const sourceRefs = new Set();
        for (const edge of extractWikilinks(blockLines.join('\n'))) {
            if (/source::/i.test(blockLines[edge.line - 1] ?? '')) {
                sourceRefs.add(edge.target);
            }
        }
        results.push({
            type: headerMatch[1].toLowerCase(),
            rawHeader: (rawLines[startIndex] ?? '').trim(),
            content: contentText,
            sourceRefs: [...sourceRefs],
            blockId,
            line: startIndex + 1 + countLines(fullText.slice(0, baseOffset)),
            endLine: endIndex + 1 + countLines(fullText.slice(0, baseOffset)),
            position,
        });
    }
    return results;
}
function buildSections(frontmatter, semantic, headings, callouts, fullText) {
    const sections = [];
    if (frontmatter.bodyOffset > 0) {
        sections.push({
            type: 'frontmatter',
            position: sourceRange(fullText, 0, frontmatter.bodyOffset),
        });
    }
    for (const range of semantic.ranges) {
        sections.push({
            type: range.type,
            position: sourceRange(fullText, frontmatter.bodyOffset + range.start, frontmatter.bodyOffset + range.end),
        });
    }
    for (const heading of headings) {
        sections.push({
            type: 'heading',
            position: sourceRange(fullText, frontmatter.bodyOffset + heading.start, frontmatter.bodyOffset + heading.end),
        });
    }
    for (const callout of callouts) {
        sections.push({
            type: 'callout',
            position: callout.position,
        });
    }
    return sections.sort((left, right) => left.position.start.offset - right.position.start.offset ||
        left.position.end.offset - right.position.end.offset ||
        left.type.localeCompare(right.type));
}
function readFrontmatterTags(value) {
    if (typeof value === 'string') {
        return value.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string');
    }
    return [];
}
function normalizeTag(value) {
    return value.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
}
function isValidTag(value) {
    const normalized = normalizeTag(value);
    return Boolean(normalized) && /[\p{L}\p{M}_]/u.test(normalized);
}
function collectStringValues(value, output, depth = 0) {
    if (depth >= 32) {
        return;
    }
    if (typeof value === 'string') {
        output.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectStringValues(item, output, depth + 1);
        }
        return;
    }
    if (isPlainRecord(value)) {
        for (const item of Object.values(value)) {
            collectStringValues(item, output, depth + 1);
        }
    }
}
function sourceRange(fullText, start, end) {
    return sourceRangeFromLineOffsets(fullText, lineStartOffsets(fullText), start, end);
}
function sourceRangeFromLineOffsets(fullText, lineOffsets, start, end) {
    return {
        start: sourceLocationFromLineOffsets(fullText, lineOffsets, start),
        end: sourceLocationFromLineOffsets(fullText, lineOffsets, end),
    };
}
function sourceLocationFromLineOffsets(fullText, lineOffsets, rawOffset) {
    const offset = Math.max(0, Math.min(fullText.length, rawOffset));
    let low = 0;
    let high = lineOffsets.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if ((lineOffsets[middle] ?? 0) <= offset) {
            low = middle + 1;
        }
        else {
            high = middle;
        }
    }
    const lineIndex = Math.max(0, low - 1);
    const lineStart = lineOffsets[lineIndex] ?? 0;
    return {
        line: lineIndex + 1,
        column: offset - lineStart + 1,
        offset,
    };
}
function lineStartOffsets(content) {
    const offsets = [0];
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === '\n') {
            offsets.push(index + 1);
        }
    }
    return offsets;
}
function countLines(content) {
    let count = 0;
    for (const character of content) {
        if (character === '\n') {
            count += 1;
        }
    }
    return count;
}
function claimUnoccupiedRange(start, end, occupied) {
    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(occupied.length, end);
    for (let index = boundedStart; index < boundedEnd; index += 1) {
        if (occupied[index] !== 0) {
            return false;
        }
    }
    occupied.fill(1, boundedStart, boundedEnd);
    return true;
}
function releaseRange(start, end, occupied) {
    occupied.fill(0, Math.max(0, start), Math.min(occupied.length, end));
}
function compareEdges(left, right) {
    return (left.position.start.offset - right.position.start.offset ||
        left.position.end.offset - right.position.end.offset ||
        left.raw.localeCompare(right.raw));
}
function collapseMaskedText(value) {
    return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}
