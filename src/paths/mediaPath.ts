import path from "node:path";

/** Columns a path generator may read. */
export interface MediaPathSubject {
	disk?: null | string;
	model_type?: null | string;
	model_id?: null | number;
	model_uuid?: null | string;
}

/**
 * Decides where a media item lives inside its disk. Conversions are stored in
 * a `conversions/` subdirectory of the returned directory.
 */
export interface PathGenerator {
	getDirectory(media: MediaPathSubject): string;
	/**
	 * Older directories that may still hold the original file. Tried in order
	 * after `getDirectory` when copying media.
	 */
	getFallbackDirectories?(media: MediaPathSubject): string[];
}

export interface DefaultPathGeneratorOptions {
	/**
	 * Disks whose directory is prefixed with the disk name, to namespace several
	 * disks that share one filesystem root (e.g. `["local"]`).
	 */
	prefixedDisks?: string[];
}

/** `ProductReview` → `product-review`. */
export const normalizeModelType = (modelType?: null | string) => {
	if (typeof modelType !== "string") {
		return "unknown";
	}

	const normalizedModelType = modelType
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();

	return normalizedModelType || "unknown";
};

/** The owner key: `model_uuid` when present, else `model_id`. */
export const getModelIdentifier = (media: MediaPathSubject) => {
	if (typeof media.model_uuid === "string" && media.model_uuid.length > 0) {
		return media.model_uuid;
	}

	if (typeof media.model_id === "number") {
		return String(media.model_id);
	}

	return "";
};

const normalizePathSegment = (value: string) =>
	value.trim().replace(/[\\/]+/g, "-");

/**
 * Default layout: `{model-type}/{owner-id}/`, optionally prefixed with the
 * disk name for disks listed in `prefixedDisks`.
 */
export const createDefaultPathGenerator = (
	options: DefaultPathGeneratorOptions = {},
): PathGenerator => {
	const prefixedDisks = new Set(options.prefixedDisks ?? []);

	return {
		getDirectory(media) {
			const disk = typeof media.disk === "string" ? media.disk : "";
			const directory = path.join(
				normalizeModelType(media.model_type),
				normalizePathSegment(getModelIdentifier(media)),
			);

			return prefixedDisks.has(disk) ? path.join(disk, directory) : directory;
		},
	};
};

const CONVERSION_FORMAT_EXTENSIONS: Record<string, string> = {
	avif: ".avif",
	jpeg: ".jpg",
	png: ".png",
	webp: ".webp",
};

/**
 * Build the file name of a conversion, e.g. `banner-w640.webp`. Keeps the
 * original extension when the conversion keeps the format.
 */
export const getConversionFileName = ({
	conversionName,
	fileName,
	format,
}: {
	conversionName: string;
	fileName: string;
	format?: null | string;
}) => {
	const originalExt = path.extname(fileName);
	const baseName = path.basename(fileName, originalExt);
	const ext =
		(format && CONVERSION_FORMAT_EXTENSIONS[format]) || originalExt || "";

	return `${baseName}-${conversionName}${ext}`;
};

export const getConversionRelativePath = (
	relativeDirectory: string,
	conversionFileName: string,
) => path.join(relativeDirectory, "conversions", conversionFileName);

/**
 * Resolve the stored conversion file name from `generated_conversions`.
 * Legacy entries (`{name: true}`) fall back to the original-extension naming.
 */
export const resolveConversionFileName = (
	fileName: string,
	conversionName: string,
	entry: unknown,
) => {
	if (
		entry &&
		typeof entry === "object" &&
		typeof (entry as { file_name?: unknown }).file_name === "string"
	) {
		return (entry as { file_name: string }).file_name;
	}

	return getConversionFileName({ conversionName, fileName });
};

/** Parse a JSON object column; anything that is not a plain object becomes `{}`. */
export const parseJsonColumn = (
	raw?: null | string | Record<string, unknown>,
): Record<string, unknown> => {
	if (raw && typeof raw === "object") {
		return Array.isArray(raw) ? {} : raw;
	}

	try {
		const parsed = JSON.parse(raw || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
};
