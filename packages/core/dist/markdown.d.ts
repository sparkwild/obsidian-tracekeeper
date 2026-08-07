import { type NormalizedVaultCallout, type NormalizedVaultEdge, type NormalizedVaultSection } from './knowledge-note';
export interface ParsedFrontmatter {
    fields: Record<string, unknown>;
    raw: string;
    body: string;
    errors: string[];
    bodyOffset: number;
    bodyStartLine: number;
}
export interface Wikilink extends NormalizedVaultEdge {
}
export interface CalloutBlock extends NormalizedVaultCallout {
}
export interface ParsedMarkdown {
    frontmatter: ParsedFrontmatter;
    title: string;
    body: string;
    tags: string[];
    headings: string[];
    blockIds: string[];
    wikilinks: Wikilink[];
    edges: NormalizedVaultEdge[];
    sections: NormalizedVaultSection[];
    callouts: CalloutBlock[];
    claimBlocks: CalloutBlock[];
    evidenceBlocks: CalloutBlock[];
    searchText: string;
}
export declare function parseFrontmatter(rawContent: string): ParsedFrontmatter;
export declare function extractWikilinks(content: string): Wikilink[];
export declare function extractHeadings(content: string): string[];
export declare function extractTags(frontmatter: Record<string, unknown>, content: string): string[];
export declare function extractBlockIds(content: string): string[];
export declare function parseMarkdown(rawContent: string): ParsedMarkdown;
