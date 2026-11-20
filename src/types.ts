export type MediaVisibility = "public" | "private";

/**
 * Anything that can own media. `getModelType()` is stored in `model_type`;
 * numeric ids go to `model_id`, everything else to `model_uuid`.
 */
export type MediaOwner = { id: string | number; getModelType(): string };

/**
 * A file held in memory. Structurally compatible with `Express.Multer.File`
 * when multer uses memory storage.
 */
export interface MediaFile {
	buffer: Buffer;
	originalname: string;
	mimetype: string;
	size: number;
	fieldname?: string;
	encoding?: string;
}

export interface MediaConversionSettings {
	name: string;
	width?: number;
	height?: number;
	format?: "jpeg" | "png" | "webp" | "avif";
	quality?: number;
	fit?: "cover" | "contain" | "fill" | "inside" | "outside";
	withoutEnlargement?: boolean;
}

/** Metadata stored per conversion name in `generated_conversions`. */
export interface MediaGeneratedConversion {
	file_name: string;
	width: number;
	height: number;
	format: string;
	size: number;
}

export interface MediaVariant {
	name: string;
	url: string;
	width: number;
	height: number;
	format: string;
}

export interface MediaUrls {
	original: string;
	conversions: Record<string, string>;
}

export interface MediaCollectionDefinition {
	/** Defaults to `"public"`. Private media is stored without public ACLs and served through temporary URLs. */
	visibility?: MediaVisibility;
	/** Disk used when the caller does not pick one. Falls back to the library default disk. */
	disk?: string;
	/** Image conversions generated for convertible public media. */
	conversions?: MediaConversionSettings[];
	/**
	 * Serve public files with an immutable Cache-Control header. File names get
	 * a content hash so a re-upload never reuses a cached object key.
	 */
	immutableCache?: boolean;
	/**
	 * Keep one item per owner: after a new item is stored, the owner's other
	 * items in this collection are deleted. A failed upload keeps the old item.
	 */
	singleFile?: boolean;
	/** Accepted MIME types, exact (`image/png`) or wildcard (`image/*`). */
	acceptsMimeTypes?: string[];
	/** Maximum file size in bytes. */
	maxFileSize?: number;
}

export interface AddMediaOptions {
	collection?: string;
	disk?: string;
	/** Overrides the file's original name (it is still sanitized). */
	fileName?: string;
	customProperties?: Record<string, unknown>;
	order?: number;
}

export interface MediaLogger {
	info(message: string, ...meta: unknown[]): void;
	warn(message: string, ...meta: unknown[]): void;
	error(message: string, ...meta: unknown[]): void;
}

export const noopLogger: MediaLogger = {
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};
