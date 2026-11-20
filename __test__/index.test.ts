import assert from "node:assert/strict";
import { test } from "vitest";
import * as media from "../src";

test("the root entry exposes only the public runtime API", () => {
	assert.deepEqual(Object.keys(media).sort(), [
		"CONVERTIBLE_IMAGE_MIME_TYPES",
		"DEFAULT_CONVERSION_MAX_ATTEMPTS",
		"IMMUTABLE_CACHE_CONTROL",
		"Media",
		"MediaError",
		"MediaLibrary",
		"MediaNotFoundError",
		"MediaValidationError",
		"StorageManager",
		"createDefaultPathGenerator",
		"createMediaLibrary",
		"createMediaTable",
		"dropMediaTable",
		"getModelIdentifier",
		"hasKnownMimeSignature",
		"matchesMimeSignature",
		"normalizeModelType",
		"widthConversions",
	]);
});

test("library errors share a base class and keep their names", () => {
	const error = new media.MediaNotFoundError(3);

	assert.ok(error instanceof media.MediaError);
	assert.equal(error.name, "MediaNotFoundError");
	assert.equal(error.message, "Media [3] not found");
});
