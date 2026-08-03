export type AgentAuthMode = 'oauth' | 'bearer';

export interface AuthenticatedCredentialContext {
	integrationId: string;
	credentialId: string;
	authMode: AgentAuthMode;
	principalId: 'local-user';
	capabilities: readonly string[];
}

export interface AgentCredentialVerifier {
	verifyBearer(token: string): AuthenticatedCredentialContext | null | Promise<AuthenticatedCredentialContext | null>;
}

export interface PendingOAuthRequest {
	requestId: string;
	clientId: string;
	clientNameClaim: string;
	redirectUri: string;
	resource: string;
	scope: 'mcp';
	codeChallenge: string;
	state: string;
	issuedAt: number;
	expiresAt: number;
}

export type OAuthDecision =
	| { decision: 'allow'; integrationId: string }
	| { decision: 'deny' }
	| null;

export interface ApprovedOAuthExchange {
	integrationId: string;
	clientId: string;
	clientNameClaim: string;
	redirectUris: readonly string[];
	credentialId: string;
	accessToken: string;
	clientProfileId?: string;
}

export interface IssuedAccessToken {
	integrationId: string;
	credentialId: string;
	accessToken: string;
}

export interface OAuthRevocationRequest {
	integrationId?: string;
	credentialId?: string;
	token?: string;
}

export interface OAuthIntegrationPort {
	publishPendingRequest(request: PendingOAuthRequest): Promise<void>;
	readDecision(requestId: string): Promise<OAuthDecision>;
	issueOAuthCredential(input: ApprovedOAuthExchange): Promise<IssuedAccessToken>;
	revokeOAuthCredential(input: OAuthRevocationRequest): Promise<void>;
}
