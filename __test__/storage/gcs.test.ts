import assert from "node:assert/strict";
import { test } from "vitest";
import { GCSStorageAdapter } from "../../src/storage/gcs";

const buildAdapter = () => {
	const saveCalls: Array<{ path: string; options: Record<string, unknown> }> =
		[];
	const client = {
		bucket: () => ({
			file: (filePath: string) => ({
				save: async (_contents: unknown, options: Record<string, unknown>) => {
					saveCalls.push({ path: filePath, options });
				},
			}),
		}),
	};
	const adapter = new GCSStorageAdapter({
		bucket: "media",
		client: client as never,
	});

	return { adapter, saveCalls };
};

test("GCSStorageAdapter.put stores Cache-Control as object metadata", async () => {
	const { adapter, saveCalls } = buildAdapter();

	await adapter.put("/carousel/25/banner.png", Buffer.from("x"), {
		contentType: "image/png",
		visibility: "public",
		cacheControl: "public, max-age=31536000, immutable",
		metadata: { source: "upload" },
	});

	assert.equal(saveCalls[0]?.path, "carousel/25/banner.png");
	assert.deepEqual(saveCalls[0]?.options, {
		contentType: "image/png",
		metadata: {
			cacheControl: "public, max-age=31536000, immutable",
			metadata: { source: "upload" },
		},
		public: true,
	});
});

test("GCSStorageAdapter.put omits Cache-Control when not provided", async () => {
	const { adapter, saveCalls } = buildAdapter();

	await adapter.put("user/1/ktp.pdf", Buffer.from("x"), {
		contentType: "application/pdf",
		visibility: "private",
	});

	assert.deepEqual(saveCalls[0]?.options, {
		contentType: "application/pdf",
		metadata: {},
		public: false,
	});
});

test("GCSStorageAdapter.url defaults to the public bucket URL", () => {
	const adapter = new GCSStorageAdapter({ bucket: "media" });

	assert.equal(
		adapter.url("/product/1/a.png"),
		"https://storage.googleapis.com/media/product/1/a.png",
	);
	assert.throws(
		() => new GCSStorageAdapter({ bucket: "" }),
		/GCS bucket name is required/,
	);
});
