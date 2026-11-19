import assert from "node:assert/strict";
import { test } from "vitest";
import { hasKnownMimeSignature, matchesMimeSignature } from "../../src";

test("matchesMimeSignature accepts files whose magic bytes match", () => {
	assert.equal(
		matchesMimeSignature(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
			"image/png",
		),
		true,
	);
	assert.equal(
		matchesMimeSignature(Buffer.from("%PDF-1.7"), "application/pdf"),
		true,
	);
	assert.equal(
		matchesMimeSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpg"),
		true,
	);
});

test("matchesMimeSignature rejects files whose content does not match the MIME type", () => {
	assert.equal(matchesMimeSignature(Buffer.from("%PDF"), "image/png"), false);
	assert.equal(matchesMimeSignature(Buffer.alloc(0), "image/jpeg"), false);
});

test("matchesMimeSignature skips MIME types without a known signature", () => {
	assert.equal(hasKnownMimeSignature("text/plain"), false);
	assert.equal(matchesMimeSignature(Buffer.from("hello"), "text/plain"), true);
});
