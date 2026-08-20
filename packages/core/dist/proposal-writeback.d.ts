export type ProposalWritebackFormat = 'bounded_v2' | 'legacy_heading' | 'frontmatter_v1' | 'missing' | 'invalid';
export type ProposalWritebackError = 'invalid_proposal_id' | 'invalid_boundary' | 'boundary_id_mismatch' | 'legacy_boundary_ambiguous' | 'conflicting_sources' | null;
export interface ProposalWritebackResult {
    content: string;
    format: ProposalWritebackFormat;
    source: 'body' | 'frontmatter' | 'none';
    ambiguous: boolean;
    error: ProposalWritebackError;
}
export interface ResolveProposalWritebackInput {
    body: string;
    proposalId: string;
    frontmatterContent?: string;
}
export declare class ProposalWritebackFormatError extends Error {
    constructor(message: string);
}
export declare function renderProposalWritebackSection(heading: string, proposalId: string, content: string): string;
export declare function parseProposalWritebackBody(body: string, proposalId: string): ProposalWritebackResult;
export declare function resolveProposalWriteback(input: ResolveProposalWritebackInput): ProposalWritebackResult;
export declare function replaceProposalWriteback(body: string, proposalId: string, content: string): string;
