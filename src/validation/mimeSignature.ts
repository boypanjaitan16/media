/**
 * Leading magic bytes for MIME types whose content is cheap to verify.
 * Types without an entry are not checked.
 */
export const MIME_SIGNATURES: Record<string, number[][]> = {
	"application/pdf": [[0x25, 0x50, 0x44, 0x46]],
	"image/jpeg": [[0xff, 0xd8, 0xff]],
	"image/jpg": [[0xff, 0xd8, 0xff]],
	"image/png": [[0x89, 0x50, 0x4e, 0x47]],
};

export const hasKnownMimeSignature = (mimeType: string) =>
	Object.hasOwn(MIME_SIGNATURES, mimeType);

/**
 * Whether the buffer starts with a known signature of `mimeType`.
 * Returns `true` for MIME types without a known signature.
 */
export const matchesMimeSignature = (buffer: Buffer, mimeType: string) => {
	const signatures = MIME_SIGNATURES[mimeType];
	if (!signatures) {
		return true;
	}

	return signatures.some((signature) =>
		signature.every((byte, index) => buffer[index] === byte),
	);
};
