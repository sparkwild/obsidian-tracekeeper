import { localizedText, type LocalizedText } from './localization';

export interface UserFacingFailureOptions {
	context: string;
	fallback: LocalizedText;
}

export const reportUiFailure = (
	error: unknown,
	options: UserFacingFailureOptions
): string => {
	console.error(options.context, error);
	return localizedText(options.fallback);
};
