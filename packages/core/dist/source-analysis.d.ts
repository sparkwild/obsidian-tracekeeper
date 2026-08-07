export interface SourceAnalysisInput {
    source: string;
    sourceKind: string;
    analysisMode: string;
    contentLanguage?: SourceAnalysisContentLanguage;
    purpose?: string;
    content?: string;
    requestPath?: string;
}
export type SourceAnalysisContentLanguage = 'zh-CN' | 'en';
export interface SourceProposalDraft {
    title: string;
    proposalKind: string;
    evidence: string;
    riskLevel: string;
    content: string;
}
export interface SourceAnalysisResult {
    summary: string;
    excerpt: string;
    evidenceScaffolds: string[];
    claimScaffolds: string[];
    proposalDrafts: SourceProposalDraft[];
}
export declare function analyzeSourceText(input: SourceAnalysisInput): SourceAnalysisResult;
