export interface ClientRuntimeCredential {
	id: string;
	clientId: string;
	token: string;
	capabilities?: readonly string[];
	createdAt: string;
}

export function rotateClientRuntimeCredential<TCredential extends ClientRuntimeCredential>(
	credentials: readonly TCredential[],
	clientId: string,
	newToken: string,
	createdAt: string
): TCredential[] {
	if (!clientId.trim() || !newToken.trim()) {
		throw new Error('Client id and replacement token are required.');
	}
	let rotated = false;
	const next = credentials.map((credential) => {
		if (credential.clientId !== clientId) {
			return credential;
		}
		rotated = true;
		return {
			...credential,
			token: newToken,
			createdAt,
		};
	});
	if (!rotated) {
		throw new Error(`Missing runtime credential for Agent client: ${clientId}`);
	}
	return next;
}
