/** Base class for errors thrown by the media library. */
export class MediaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

export type MediaValidationErrorCode =
	| "MIME_TYPE_NOT_ACCEPTED"
	| "FILE_TOO_LARGE";

export interface MediaValidationErrorDetails {
	code: MediaValidationErrorCode;
	modelType: string;
	collection: string;
	mimeType: string;
	/** Size of the rejected file in bytes, when known. */
	size?: number;
	acceptsMimeTypes?: string[];
	maxFileSize?: number;
}

/**
 * A file was rejected by its collection's rules (`acceptsMimeTypes`,
 * `maxFileSize`). Nothing was stored. Use `code` to show your own message.
 */
export class MediaValidationError extends MediaError {
	readonly code: MediaValidationErrorCode;
	readonly modelType: string;
	readonly collection: string;
	readonly mimeType: string;
	readonly size?: number;
	readonly acceptsMimeTypes?: string[];
	readonly maxFileSize?: number;

	constructor(details: MediaValidationErrorDetails) {
		super(
			details.code === "FILE_TOO_LARGE"
				? `File of ${details.size} bytes exceeds the ${details.maxFileSize} byte limit of collection [${details.collection}]`
				: `MIME type [${details.mimeType}] is not accepted by collection [${details.collection}]`,
		);
		this.code = details.code;
		this.modelType = details.modelType;
		this.collection = details.collection;
		this.mimeType = details.mimeType;
		this.size = details.size;
		this.acceptsMimeTypes = details.acceptsMimeTypes;
		this.maxFileSize = details.maxFileSize;
	}
}

/** The media item to act on does not exist. */
export class MediaNotFoundError extends MediaError {
	readonly mediaId: number;

	constructor(mediaId: number) {
		super(`Media [${mediaId}] not found`);
		this.mediaId = mediaId;
	}
}
