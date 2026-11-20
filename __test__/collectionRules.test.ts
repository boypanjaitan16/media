import assert from "node:assert/strict";
import path from "node:path";
import { test, vi } from "vitest";
import {
	type Media,
	type MediaCollectionDefinition,
	MediaValidationError,
} from "../src";
import { createFakeDisk, createFakeStore, createTestLibrary } from "./helpers";

const product = { id: "p-1", getModelType: () => "Product" };
const pdf = {
	originalname: "doc.pdf",
	mimetype: "application/pdf",
	size: 4,
	buffer: Buffer.from("%PDF"),
};
const png = {
	originalname: "photo.png",
	mimetype: "image/png",
	size: 4,
	buffer: Buffer.from("\x89PNG"),
};

const productCollections = (
	definitions: Record<string, MediaCollectionDefinition>,
) => ({ Product: definitions });

const previousItem = {
	id: 5,
	model_type: "Product",
	model_id: null,
	model_uuid: "p-1",
	collection_name: "image_primary",
	file_name: "old.png",
	disk: "local",
	conversions_disk: "local",
	generated_conversions: JSON.stringify({
		w320: { file_name: "old-w320.webp" },
	}),
} as unknown as Media;

const destroyedIds = (store: ReturnType<typeof createFakeStore>) =>
	store.calls
		.filter((call) => call.method === "destroy")
		.map((call) => call.args[0]);

// ---------------------------------------------------------------------------
// singleFile
// ---------------------------------------------------------------------------

test("singleFile deletes the owner's previous items after storing the new one", async () => {
	const store = createFakeStore({
		findForOwner: async () => [
			previousItem,
			{ ...previousItem, id: 99 } as unknown as Media,
		],
	});
	const { library, disk } = createTestLibrary({
		store,
		collections: productCollections({ image_primary: { singleFile: true } }),
	});

	const media = await library
		.addMedia(product, png)
		.toMediaCollection("image_primary");

	assert.equal(media.id, 99);
	assert.deepEqual(destroyedIds(store), [5]);
	const deleted = disk.calls
		.filter((call) => call.method === "delete")
		.map((call) => call.args[0]);
	assert.deepEqual(deleted, [
		path.join("local", "product", "p-1", "old.png"),
		path.join("local", "product", "p-1", "conversions", "old-w320.webp"),
	]);
	// The new file is written before anything old is removed
	const methods = disk.calls.map((call) => call.method);
	assert.ok(methods.indexOf("put") < methods.indexOf("delete"));
});

test("singleFile keeps the previous item when the new upload fails", async () => {
	const store = createFakeStore({ findForOwner: async () => [previousItem] });
	const { library } = createTestLibrary({
		store,
		disks: { local: createFakeDisk("local", { put: async () => false }) },
		collections: productCollections({ image_primary: { singleFile: true } }),
	});

	await assert.rejects(
		library.addMedia(product, png).toMediaCollection("image_primary"),
		/did not store/,
	);
	// Only the row of the failed upload is removed
	assert.deepEqual(destroyedIds(store), [99]);
	assert.equal(
		store.calls.some((call) => call.method === "findForOwner"),
		false,
	);
});

test("collections without singleFile keep every item", async () => {
	const store = createFakeStore({ findForOwner: async () => [previousItem] });
	const { library } = createTestLibrary({ store });

	await library.addMedia(product, png).toMediaCollection("image_primary");

	assert.deepEqual(destroyedIds(store), []);
});

test("singleFile applies to copies", async () => {
	const source = {
		...previousItem,
		id: 10,
		model_type: "User",
		model_uuid: "u-1",
		collection_name: "photos",
		file_name: "a.png",
		mime_type: "image/png",
		size: 4,
		generated_conversions: "{}",
	} as unknown as Media;
	const store = createFakeStore({
		findById: async () => source,
		findForOwner: async () => [previousItem],
	});
	const { library, disk } = createTestLibrary({
		store,
		collections: productCollections({ image_primary: { singleFile: true } }),
	});
	disk.files.set(path.join("local", "user", "u-1", "a.png"), Buffer.from("a"));

	await library.copyMedia(product, 10).toMediaCollection("image_primary");

	assert.deepEqual(destroyedIds(store), [5]);
});

test("a failing cleanup is logged and still returns the new media", async () => {
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const store = createFakeStore({
		findForOwner: async () => {
			throw new Error("db down");
		},
	});
	const { library } = createTestLibrary({
		store,
		logger,
		collections: productCollections({ image_primary: { singleFile: true } }),
	});

	const media = await library
		.addMedia(product, png)
		.toMediaCollection("image_primary");

	assert.equal(media.id, 99);
	assert.match(
		logger.error.mock.calls[0]?.[0],
		/single-file collection \[image_primary\]/,
	);
});

// ---------------------------------------------------------------------------
// acceptsMimeTypes / maxFileSize
// ---------------------------------------------------------------------------

test("acceptsMimeTypes accepts exact and wildcard types", async () => {
	const { library, store } = createTestLibrary({
		collections: productCollections({
			images: { acceptsMimeTypes: ["image/*"] },
			documents: { acceptsMimeTypes: ["application/pdf"] },
		}),
	});

	await library.addMedia(product, png).toMediaCollection("images");
	await library
		.addMedia(product, { ...pdf, mimetype: "Application/PDF" })
		.toMediaCollection("documents");

	assert.equal(store.created.length, 2);
});

test("acceptsMimeTypes rejects other types before anything is stored", async () => {
	const { library, store, disk } = createTestLibrary({
		collections: productCollections({
			images: { acceptsMimeTypes: ["image/png", "image/jpeg"] },
		}),
	});

	await assert.rejects(
		library.addMedia(product, pdf).toMediaCollection("images"),
		(error: unknown) => {
			assert.ok(error instanceof MediaValidationError);
			assert.equal(error.code, "MIME_TYPE_NOT_ACCEPTED");
			assert.equal(error.modelType, "Product");
			assert.equal(error.collection, "images");
			assert.equal(error.mimeType, "application/pdf");
			assert.deepEqual(error.acceptsMimeTypes, ["image/png", "image/jpeg"]);
			return true;
		},
	);
	assert.equal(store.calls.length, 0);
	assert.equal(disk.calls.length, 0);
});

test("maxFileSize rejects larger files", async () => {
	const { library, store } = createTestLibrary({
		collections: productCollections({ images: { maxFileSize: 3 } }),
	});

	await assert.rejects(
		library.addMedia(product, png).toMediaCollection("images"),
		(error: unknown) => {
			assert.ok(error instanceof MediaValidationError);
			assert.equal(error.code, "FILE_TOO_LARGE");
			assert.equal(error.size, 4);
			assert.equal(error.maxFileSize, 3);
			return true;
		},
	);
	assert.equal(store.calls.length, 0);
});

test("addMediaFromUrl rejects from the response headers without reading the body", async () => {
	const { library, store } = createTestLibrary({
		collections: productCollections({
			images: { acceptsMimeTypes: ["image/*"], maxFileSize: 1000 },
		}),
	});
	const arrayBuffer = vi.fn();
	const cancel = vi.fn(async () => undefined);
	const respond = (headers: Record<string, string>) =>
		({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
			body: { cancel },
			arrayBuffer,
		}) as never;
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(
			respond({ "content-type": "image/png", "content-length": "5000" }),
		)
		.mockResolvedValueOnce(respond({ "content-type": "text/html" }));

	try {
		await assert.rejects(
			library
				.addMediaFromUrl(product, "https://cdn.example.com/big.png")
				.toMediaCollection("images"),
			(error: unknown) =>
				error instanceof MediaValidationError &&
				error.code === "FILE_TOO_LARGE" &&
				error.size === 5000,
		);
		await assert.rejects(
			library
				.addMediaFromUrl(product, "https://cdn.example.com/page")
				.toMediaCollection("images"),
			(error: unknown) =>
				error instanceof MediaValidationError &&
				error.code === "MIME_TYPE_NOT_ACCEPTED",
		);

		assert.equal(arrayBuffer.mock.calls.length, 0);
		assert.equal(cancel.mock.calls.length, 2);
		assert.equal(store.calls.length, 0);
	} finally {
		fetchMock.mockRestore();
	}
});

test("addMediaFromUrl checks the downloaded size when content-length is missing", async () => {
	const { library, store } = createTestLibrary({
		collections: productCollections({ images: { maxFileSize: 3 } }),
	});
	const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: true,
		status: 200,
		statusText: "OK",
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type"
					? "image/png; charset=binary"
					: null,
		},
		arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
	} as never);

	try {
		await assert.rejects(
			library
				.addMediaFromUrl(product, "https://cdn.example.com/a.png")
				.toMediaCollection("images"),
			(error: unknown) =>
				error instanceof MediaValidationError &&
				error.code === "FILE_TOO_LARGE" &&
				error.mimeType === "image/png" &&
				error.size === 4,
		);
		assert.equal(store.calls.length, 0);
	} finally {
		fetchMock.mockRestore();
	}
});

test("copyMedia validates against the target collection", async () => {
	const source = {
		...previousItem,
		id: 10,
		mime_type: "application/pdf",
		size: 4,
	} as unknown as Media;
	const store = createFakeStore({ findById: async () => source });
	const { library } = createTestLibrary({
		store,
		collections: productCollections({
			images: { acceptsMimeTypes: ["image/*"] },
		}),
	});

	await assert.rejects(
		library.copyMedia(product, 10).toMediaCollection("images"),
		(error: unknown) =>
			error instanceof MediaValidationError &&
			error.code === "MIME_TYPE_NOT_ACCEPTED",
	);
	assert.equal(store.created.length, 0);
});
