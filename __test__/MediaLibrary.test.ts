import assert from "node:assert/strict";
import path from "node:path";
import { test, vi } from "vitest";
import {
	createDefaultPathGenerator,
	IMMUTABLE_CACHE_CONTROL,
	type Media,
	type MediaCollectionDefinition,
	MediaNotFoundError,
	widthConversions,
} from "../src";
import {
	createFakeDisk,
	createFakeStore,
	createPng,
	createTestLibrary,
} from "./helpers";

const BANNER_COLLECTIONS: Record<
	string,
	Record<string, MediaCollectionDefinition>
> = {
	Carousel: {
		image_primary: {
			conversions: widthConversions([640, 1280, 1920]),
			immutableCache: true,
		},
	},
	User: { id_card: { visibility: "private" } },
};

const carousel = { id: 25, getModelType: () => "Carousel" };

const pngFile = async (originalname = "Banner.png") => {
	const buffer = await createPng(800, 200);
	return {
		originalname,
		mimetype: "image/png",
		size: buffer.length,
		buffer,
	};
};

const buildCarouselMedia = (overrides: Record<string, unknown> = {}) =>
	({
		id: 31,
		model_type: "Carousel",
		model_id: 25,
		model_uuid: null,
		collection_name: "image_primary",
		file_name: "banner.png",
		mime_type: "image/png",
		disk: "local",
		conversions_disk: "local",
		visibility: "public",
		custom_properties: "{}",
		generated_conversions: "{}",
		...overrides,
	}) as unknown as Media;

// ---------------------------------------------------------------------------
// addMedia
// ---------------------------------------------------------------------------

test("addMedia stores the file under the owner directory with sanitized names", async () => {
	const { library, store, disk } = createTestLibrary();

	const media = await library
		.addMedia(
			{ id: "user-1", getModelType: () => "User" },
			{
				originalname: "KTP Saya.pdf",
				mimetype: "application/pdf",
				size: 4,
				buffer: Buffer.from("%PDF"),
			},
		)
		.withCustomProperties({ source: "upload" })
		.toMediaCollection("documents");

	assert.equal(media.id, 99);
	assert.deepEqual(store.created[0], {
		id: 99,
		model_type: "User",
		model_id: null,
		model_uuid: "user-1",
		collection_name: "documents",
		name: "ktp_saya",
		file_name: "ktp_saya.pdf",
		mime_type: "application/pdf",
		disk: "local",
		conversions_disk: "local",
		size: 4,
		manipulations: "{}",
		custom_properties: '{"source":"upload"}',
		generated_conversions: "{}",
		responsive_images: "{}",
		order_column: 0,
		visibility: "public",
	});
	const put = disk.calls.find((call) => call.method === "put");
	assert.equal(
		put?.args[0],
		path.join("local", "user", "user-1", "ktp_saya.pdf"),
	);
	assert.deepEqual(put?.args[2], {
		contentType: "application/pdf",
		visibility: "public",
		cacheControl: undefined,
	});
});

test("addMedia applies collection visibility, disk and the default collection", async () => {
	const gcs = createFakeDisk("gcs");
	const local = createFakeDisk("local");
	const { library, store } = createTestLibrary({
		disks: { local, gcs },
		collections: {
			...BANNER_COLLECTIONS,
			User: { id_card: { visibility: "private", disk: "gcs" } },
		},
	});
	const user = { id: "user-1", getModelType: () => "User" };
	const file = {
		originalname: "a.pdf",
		mimetype: "application/pdf",
		size: 1,
		buffer: Buffer.from("x"),
	};

	await library.addMedia(user, file).toMediaCollection("id_card");
	await library.addMedia(user, file).toMediaCollection();

	assert.equal(store.created[0]?.visibility, "private");
	assert.equal(store.created[0]?.disk, "gcs");
	assert.equal(
		gcs.calls.find((call) => call.method === "put")?.args[0],
		path.join("user", "user-1", "a.pdf"),
	);
	assert.equal(store.created[1]?.collection_name, "default");
	assert.equal(store.created[1]?.visibility, "public");
	assert.equal(
		local.calls.find((call) => call.method === "put")?.args[0],
		path.join("local", "user", "user-1", "a.pdf"),
	);
});

test("addMedia honours usingFileName and never produces dot-only names", async () => {
	const { library, store } = createTestLibrary();
	const file = {
		originalname: "x.png",
		mimetype: "text/plain",
		size: 1,
		buffer: Buffer.from("x"),
	};

	await library
		.addMedia(carousel, file)
		.usingFileName("My Photo.txt")
		.toMediaCollection("other");
	await library
		.addMedia(carousel, { ...file, originalname: ".." })
		.toMediaCollection();

	assert.equal(store.created[0]?.file_name, "my_photo.txt");
	assert.equal(store.created[1]?.file_name, "file");
});

test("addMedia hashes immutable-cache file names, sets Cache-Control and generates variants", async () => {
	const { library, store, disk } = createTestLibrary({
		collections: BANNER_COLLECTIONS,
	});

	await library
		.addMedia(carousel, await pngFile("Promo Banner.png"))
		.toMediaCollection("image_primary");

	const inserted = store.created[0] as { name: string; file_name: string };
	assert.equal(inserted.name, "promo_banner");
	assert.match(inserted.file_name, /^promo_banner-[0-9a-f]{10}\.png$/);

	const puts = disk.calls.filter((call) => call.method === "put");
	assert.equal(puts.length, 4, "original and three variants");
	for (const call of puts) {
		assert.equal(
			(call.args[2] as { cacheControl?: string }).cacheControl,
			IMMUTABLE_CACHE_CONTROL,
		);
	}
	const update = store.calls.find((call) => call.method === "update");
	assert.deepEqual(
		Object.keys(
			JSON.parse(
				(update?.args[1] as { generated_conversions: string })
					.generated_conversions,
			),
		),
		["w640", "w1280", "w1920"],
	);
});

test("addMedia keeps the upload when conversions fail", async () => {
	const disk = createFakeDisk("local", {
		put: async (filePath) => {
			if (filePath.includes("conversions"))
				throw new Error("bucket unavailable");
			return true;
		},
	});
	const { library, store } = createTestLibrary({
		disks: { local: disk },
		collections: BANNER_COLLECTIONS,
	});

	const media = await library
		.addMedia(carousel, await pngFile())
		.toMediaCollection("image_primary");

	assert.equal(media.id, 99);
	assert.match(
		disk.calls.filter((call) => call.method === "put")[0]?.args[0] as string,
		/^local[\\/]carousel[\\/]25[\\/]banner-[0-9a-f]{10}\.png$/,
	);
	assert.equal(
		store.calls.some((call) => call.method === "destroy"),
		false,
	);
	const update = store.calls.find((call) => call.method === "update");
	assert.deepEqual(update?.args, [
		99,
		{ custom_properties: '{"conversion_attempts":1}' },
	]);
});

test("addMedia removes the row and rethrows when the original cannot be stored", async () => {
	const disk = createFakeDisk("local", { put: async () => false });
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const { library, store } = createTestLibrary({
		disks: { local: disk },
		logger,
	});

	await assert.rejects(
		library.addMedia(carousel, await pngFile()).toMediaCollection("other"),
		/did not store/,
	);
	assert.deepEqual(
		store.calls
			.filter((call) => call.method === "destroy")
			.map((call) => call.args),
		[[99]],
	);
	assert.equal(
		logger.error.mock.calls[0]?.[0],
		"Failed to add media for [Carousel] [25]",
	);
});

test("addMediaFromUrl downloads the file and names it after the URL path", async () => {
	const { library, store } = createTestLibrary();
	const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: true,
		status: 200,
		statusText: "OK",
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? "image/png" : null,
		},
		arrayBuffer: async () =>
			new Uint8Array([...Buffer.from("image-bytes")]).buffer,
	} as never);

	try {
		await library
			.addMediaFromUrl(
				carousel,
				"https://cdn.example.com/path/photo.png?size=large",
			)
			.toMediaCollection("remote");
		await library
			.addMediaFromUrl(carousel, "https://cdn.example.com/x")
			.usingFileName("25_avatar.jpg")
			.toMediaCollection();

		assert.equal(
			fetchMock.mock.calls[0]?.[0],
			"https://cdn.example.com/path/photo.png?size=large",
		);
		assert.equal(store.created[0]?.file_name, "photo.png");
		assert.equal(store.created[0]?.mime_type, "image/png");
		assert.equal(store.created[0]?.size, Buffer.from("image-bytes").length);
		assert.equal(store.created[0]?.collection_name, "remote");
		assert.equal(store.created[1]?.file_name, "25_avatar.jpg");
	} finally {
		fetchMock.mockRestore();
	}
});

test("addMediaFromUrl throws when the download fails", async () => {
	const { library, store } = createTestLibrary();
	const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: false,
		status: 404,
		statusText: "Not Found",
	} as never);

	try {
		await assert.rejects(
			library
				.addMediaFromUrl(carousel, "https://cdn.example.com/missing.png")
				.toMediaCollection(),
			/Failed to download media from URL: 404 Not Found/,
		);
		assert.equal(store.created.length, 0);
	} finally {
		fetchMock.mockRestore();
	}
});

// ---------------------------------------------------------------------------
// copyMedia
// ---------------------------------------------------------------------------

const sourceMedia = {
	id: 10,
	model_type: "User",
	model_id: null,
	model_uuid: "13ab45cd",
	collection_name: "id_card",
	name: "ktp",
	file_name: "ktp.pdf",
	mime_type: "application/pdf",
	disk: "local",
	conversions_disk: "local",
	size: 100,
	manipulations: "{}",
	custom_properties: "{}",
	generated_conversions: JSON.stringify({
		w640: { file_name: "ktp-w640.webp" },
	}),
	responsive_images: "{}",
	order_column: 0,
	visibility: "private",
} as unknown as Media;

const orderDocument = { id: 5678, getModelType: () => "OrderDocument" };

test("copyMedia duplicates the row, the file and its conversions", async () => {
	const { library, store, disk } = createTestLibrary({
		store: createFakeStore({ findById: async () => sourceMedia }),
	});
	disk.files.set(
		path.join("local", "user", "13ab45cd", "ktp.pdf"),
		Buffer.from("pdf"),
	);
	disk.files.set(
		path.join("local", "user", "13ab45cd", "conversions", "ktp-w640.webp"),
		Buffer.from("w"),
	);

	const copied = await library
		.copyMedia(orderDocument, 10)
		.toMediaCollection("id_card");

	assert.equal(copied.id, 99);
	const { id: _id, ...attributes } = store.created[0] as Record<
		string,
		unknown
	>;
	assert.deepEqual(attributes, {
		model_type: "OrderDocument",
		model_id: 5678,
		model_uuid: null,
		collection_name: "id_card",
		name: "ktp",
		file_name: "id_card-10-ktp.pdf",
		mime_type: "application/pdf",
		disk: "local",
		conversions_disk: "local",
		size: 100,
		manipulations: "{}",
		custom_properties: "{}",
		generated_conversions: sourceMedia.generated_conversions,
		responsive_images: "{}",
		order_column: 0,
		visibility: "private",
	});
	assert.deepEqual(
		disk.calls
			.filter((call) => call.method === "copy")
			.map((call) => call.args),
		[
			[
				path.join("local", "user", "13ab45cd", "ktp.pdf"),
				path.join("local", "order-document", "5678", "id_card-10-ktp.pdf"),
			],
			[
				path.join("local", "user", "13ab45cd", "conversions", "ktp-w640.webp"),
				path.join(
					"local",
					"order-document",
					"5678",
					"conversions",
					"ktp-w640.webp",
				),
			],
		],
	);
});

test("copyMedia falls back to the path generator's fallback directories", async () => {
	const baseGenerator = createDefaultPathGenerator({
		prefixedDisks: ["local"],
	});
	const { library, disk } = createTestLibrary({
		store: createFakeStore({ findById: async () => sourceMedia }),
		pathGenerator: {
			getDirectory: baseGenerator.getDirectory,
			getFallbackDirectories: () => [path.join("legacy", "13", "ab")],
		},
	});
	disk.files.set(
		path.join("legacy", "13", "ab", "ktp.pdf"),
		Buffer.from("pdf"),
	);

	await library.copyMedia(orderDocument, 10).toMediaCollection();

	assert.deepEqual(
		disk.calls
			.filter((call) => call.method === "copy")
			.slice(0, 2)
			.map((call) => call.args[0]),
		[
			path.join("local", "user", "13ab45cd", "ktp.pdf"),
			path.join("legacy", "13", "ab", "ktp.pdf"),
		],
	);
});

test("copyMedia throws and cleans up when the file cannot be copied", async () => {
	const { library, store, disk } = createTestLibrary({
		store: createFakeStore({ findById: async () => sourceMedia }),
	});

	await assert.rejects(
		library.copyMedia(orderDocument, 10).toMediaCollection("id_card"),
		/Failed to duplicate media file \[10\]/,
	);
	assert.deepEqual(
		store.calls
			.filter((call) => call.method === "destroy")
			.map((call) => call.args),
		[[99]],
	);
	assert.ok(disk.calls.some((call) => call.method === "delete"));
});

test("copyMedia throws when the source does not exist", async () => {
	const { library } = createTestLibrary();

	await assert.rejects(
		library.copyMedia(orderDocument, 1).toMediaCollection(),
		(error: unknown) =>
			error instanceof MediaNotFoundError && error.mediaId === 1,
	);
});

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

test("performConversions writes resized webp variants", async () => {
	const { library, store, disk } = createTestLibrary({
		collections: BANNER_COLLECTIONS,
	});
	const media = buildCarouselMedia();

	const result = await library.performConversions(
		media,
		await createPng(1600, 400),
	);

	const puts = disk.calls.filter((call) => call.method === "put");
	assert.deepEqual(
		puts.map((call) => call.args[0]),
		["w640", "w1280", "w1920"].map((name) =>
			path.join(
				"local",
				"carousel",
				"25",
				"conversions",
				`banner-${name}.webp`,
			),
		),
	);
	for (const call of puts) {
		const options = call.args[2] as Record<string, unknown>;
		assert.equal(options.contentType, "image/webp");
		assert.equal(options.visibility, "public");
	}
	assert.equal(result.w640?.width, 640);
	assert.equal(result.w640?.height, 160);
	// withoutEnlargement keeps the 1600px source width for the 1920 variant
	assert.equal(result.w1920?.width, 1600);
	assert.equal(result.w640?.format, "webp");
	assert.deepEqual(store.calls.find((call) => call.method === "update")?.args, [
		31,
		{ generated_conversions: JSON.stringify(result) },
	]);
	assert.equal(media.generated_conversions, JSON.stringify(result));
});

test("performConversions reads the original from disk without a source buffer", async () => {
	const { library, disk } = createTestLibrary({
		collections: BANNER_COLLECTIONS,
	});
	disk.files.set(
		path.join("local", "carousel", "25", "banner.png"),
		await createPng(700, 100),
	);

	const result = await library.performConversions(buildCarouselMedia());

	assert.equal(result.w640?.width, 640);
});

test("generateConversions skips unregistered, private and non-image media", async () => {
	const { library, disk } = createTestLibrary({
		collections: BANNER_COLLECTIONS,
	});
	const source = await createPng(100, 100);

	for (const overrides of [
		{ model_type: "User", collection_name: "avatar" },
		{ visibility: "private" },
		{ mime_type: "application/pdf" },
	]) {
		assert.equal(
			await library.generateConversions(buildCarouselMedia(overrides), source),
			false,
		);
	}
	assert.equal(disk.calls.length, 0);
});

test("generateConversions records failed attempts without throwing", async () => {
	const disk = createFakeDisk("local", {
		put: async () => {
			throw new Error("bucket unavailable");
		},
	});
	const { library, store } = createTestLibrary({
		disks: { local: disk },
		collections: BANNER_COLLECTIONS,
	});
	const media = buildCarouselMedia({
		custom_properties: JSON.stringify({
			source: "admin",
			conversion_attempts: 1,
		}),
	});

	assert.equal(
		await library.generateConversions(media, await createPng(800, 200)),
		false,
	);
	assert.deepEqual(store.calls.find((call) => call.method === "update")?.args, [
		31,
		{
			custom_properties: JSON.stringify({
				source: "admin",
				conversion_attempts: 2,
			}),
		},
	]);
	assert.equal(library.shouldRetryConversions(media), true);
	assert.equal(
		library.shouldRetryConversions(
			buildCarouselMedia({ custom_properties: '{"conversion_attempts":3}' }),
		),
		false,
	);
});

test("findPendingConversions queries only collections with conversions", async () => {
	const { library, store } = createTestLibrary({
		collections: {
			...BANNER_COLLECTIONS,
			Product: {
				image_primary: { conversions: widthConversions([320]) },
				manual: { visibility: "public" },
			},
		},
	});

	await library.findPendingConversions({ afterId: 9, limit: 5 });

	const query = store.calls.find(
		(call) => call.method === "findPendingConversions",
	)?.args[0] as Record<string, unknown>;
	assert.equal(query.afterId, 9);
	assert.equal(query.limit, 5);
	assert.deepEqual(query.targets, [
		{ modelType: "Carousel", collections: ["image_primary"] },
		{ modelType: "Product", collections: ["image_primary"] },
	]);
});

test("getCacheControl applies only to public media in immutable-cache collections", () => {
	const { library } = createTestLibrary({ collections: BANNER_COLLECTIONS });

	assert.equal(
		library.getCacheControl({
			model_type: "Carousel",
			collection_name: "image_primary",
			visibility: "public",
		}),
		IMMUTABLE_CACHE_CONTROL,
	);
	assert.equal(
		library.getCacheControl({
			model_type: "Carousel",
			collection_name: "image_primary",
			visibility: "private",
		}),
		undefined,
	);
	assert.equal(
		library.getCacheControl({
			model_type: "User",
			collection_name: "avatar",
			visibility: "public",
		}),
		undefined,
	);
});

test("defineCollections merges definitions for the same collection", () => {
	const { library } = createTestLibrary();

	library.defineCollections("User", { avatar: { visibility: "private" } });
	library.defineCollections("User", { avatar: { immutableCache: true } });

	assert.deepEqual(library.getCollection("User", "avatar"), {
		visibility: "private",
		immutableCache: true,
	});
	assert.equal(library.getCollection("User", null), undefined);
});

// ---------------------------------------------------------------------------
// Queries and mutations
// ---------------------------------------------------------------------------

test("getMedia and getFirstMedia query by owner reference", async () => {
	const { library, store } = createTestLibrary();

	await library.getMedia(
		{ id: "uuid-1", getModelType: () => "Product" },
		"image_gallery",
	);
	await library.getFirstMedia(carousel);
	await library.findMedia(5);

	assert.deepEqual(
		store.calls.map((call) => [call.method, call.args]),
		[
			[
				"findForOwner",
				[
					{ model_type: "Product", model_id: null, model_uuid: "uuid-1" },
					"image_gallery",
				],
			],
			[
				"findFirstForOwner",
				[{ model_type: "Carousel", model_id: 25, model_uuid: null }, "default"],
			],
			["findById", [5]],
		],
	);
});

test("deleteMedia returns false when the media does not exist", async () => {
	const { library, store, disk } = createTestLibrary();

	assert.equal(await library.deleteMedia(101), false);
	assert.equal(disk.calls.length, 0);
	assert.equal(
		store.calls.some((call) => call.method === "destroy"),
		false,
	);
});

test("deleteMedia deletes the file, its conversions and the row", async () => {
	const media = buildCarouselMedia({
		generated_conversions: JSON.stringify({
			w640: { file_name: "banner-w640.webp", width: 640, height: 160 },
		}),
	});
	const { library, store, disk } = createTestLibrary({
		store: createFakeStore({ findById: async () => media }),
	});

	assert.equal(await library.deleteMedia(31), true);
	assert.deepEqual(
		disk.calls
			.filter((call) => call.method === "delete")
			.map((call) => call.args[0]),
		[
			path.join("local", "carousel", "25", "banner.png"),
			path.join("local", "carousel", "25", "conversions", "banner-w640.webp"),
		],
	);
	assert.deepEqual(
		store.calls.find((call) => call.method === "destroy")?.args,
		[31],
	);
});

test("deleteMedia returns false and keeps the row when storage deletion fails", async () => {
	const disk = createFakeDisk("local", {
		delete: async () => {
			throw new Error("disk failure");
		},
	});
	const { library, store } = createTestLibrary({ disks: { local: disk } });

	assert.equal(await library.deleteMedia(buildCarouselMedia()), false);
	assert.equal(
		store.calls.some((call) => call.method === "destroy"),
		false,
	);
});

test("clearMediaCollection deletes every media item of the owner", async () => {
	const items = [buildCarouselMedia({ id: 1 }), buildCarouselMedia({ id: 2 })];
	const { library, store } = createTestLibrary({
		store: createFakeStore({ findForOwner: async () => items }),
	});

	assert.equal(
		await library.clearMediaCollection(carousel, "image_primary"),
		true,
	);
	assert.deepEqual(
		store.calls
			.filter((call) => call.method === "destroy")
			.map((call) => call.args[0]),
		[1, 2],
	);
});

test("updateCustomProperties merges into the stored JSON", async () => {
	const { library, store } = createTestLibrary({
		store: createFakeStore({
			findById: async (id) =>
				id === 11
					? buildCarouselMedia({
							id: 11,
							custom_properties: '{"source":"camera"}',
						})
					: null,
		}),
	});

	assert.equal(
		await library.updateCustomProperties(500, { key: "value" }),
		false,
	);
	assert.equal(
		await library.updateCustomProperties(11, { description: "new" }),
		true,
	);
	assert.deepEqual(store.calls.find((call) => call.method === "update")?.args, [
		11,
		{ custom_properties: '{"source":"camera","description":"new"}' },
	]);
});

test("setNewOrder numbers media from 1 in the given order", async () => {
	const { library, store } = createTestLibrary();

	assert.equal(await library.setNewOrder([7, 3]), true);
	assert.deepEqual(
		store.calls
			.filter((call) => call.method === "update")
			.map((call) => call.args),
		[
			[7, { order_column: 1 }],
			[3, { order_column: 2 }],
		],
	);
});
