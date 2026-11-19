import assert from "node:assert/strict";
import { test } from "vitest";
import { createDefaultPathGenerator, createMediaLibrary, Media } from "../src";
import { createFakeDisk, sequelize } from "./helpers";

const library = createMediaLibrary({
	sequelize,
	tableName: "system_media",
	defaultDisk: "local",
	disks: { local: createFakeDisk("local"), gcs: createFakeDisk("gcs") },
	pathGenerator: createDefaultPathGenerator({ prefixedDisks: ["local"] }),
});

const buildMedia = (overrides: Record<string, unknown> = {}) =>
	library.Media.build(
		{
			id: 1,
			model_type: "Carousel",
			model_id: 25,
			collection_name: "image_primary",
			name: "banner",
			file_name: "banner.png",
			mime_type: "image/png",
			disk: "local",
			conversions_disk: "local",
			size: 1000,
			visibility: "public",
			generated_conversions: JSON.stringify({
				w1280: {
					file_name: "banner-w1280.webp",
					width: 1280,
					height: 371,
					format: "webp",
					size: 50_000,
				},
				w640: {
					file_name: "banner-w640.webp",
					width: 640,
					height: 185,
					format: "webp",
					size: 20_000,
				},
			}),
			...overrides,
		},
		{ isNewRecord: false },
	);

test("createMediaLibrary initializes the Media model with the configured table", () => {
	assert.equal(library.Media, Media);
	assert.equal(Media.getTableName(), "system_media");
});

test("Media exposes relative paths and URLs through virtual attributes", () => {
	const media = buildMedia();

	assert.equal(media.relative_directory, "local/carousel/25");
	assert.equal(media.relative_path, "local/carousel/25/banner.png");
	assert.equal(media.url, "https://cdn.test/local/carousel/25/banner.png");
	assert.equal(
		buildMedia({ disk: "gcs" }).url,
		"https://cdn.test/carousel/25/banner.png",
	);
	assert.equal(buildMedia({ file_name: "" }).url, "");
});

test("Media.getUrl resolves conversion paths", () => {
	const media = buildMedia();

	assert.equal(
		media.getUrl({ conversion: "w1280", pathOnly: true }),
		"local/carousel/25/conversions/banner-w1280.webp",
	);
	assert.equal(
		media.getUrl({ pathOnly: true }),
		"local/carousel/25/banner.png",
	);
	assert.deepEqual(media.getUrls(true), {
		original: "local/carousel/25/banner.png",
		conversions: {
			w1280: "local/carousel/25/conversions/banner-w1280.webp",
			w640: "local/carousel/25/conversions/banner-w640.webp",
		},
	});
});

test("Media.getVariants returns public conversions sorted by width", () => {
	const variants = buildMedia().getVariants();

	assert.deepEqual(
		variants.map(({ name, width, height, format, url }) => ({
			name,
			width,
			height,
			format,
			url,
		})),
		[
			{
				name: "w640",
				width: 640,
				height: 185,
				format: "webp",
				url: "https://cdn.test/local/carousel/25/conversions/banner-w640.webp",
			},
			{
				name: "w1280",
				width: 1280,
				height: 371,
				format: "webp",
				url: "https://cdn.test/local/carousel/25/conversions/banner-w1280.webp",
			},
		],
	);
});

test("Media.getVariants skips private media and malformed conversions", () => {
	assert.deepEqual(buildMedia({ visibility: "private" }).getVariants(), []);
	assert.deepEqual(
		buildMedia({ generated_conversions: "not-json" }).getVariants(),
		[],
	);
	assert.deepEqual(
		buildMedia({
			generated_conversions: JSON.stringify({ legacy: true }),
		}).getVariants(),
		[],
	);
});

test("Media.resolveUrl signs private media", async () => {
	assert.equal(
		await buildMedia().resolveUrl(),
		"https://cdn.test/local/carousel/25/banner.png",
	);
	assert.equal(
		await buildMedia({ visibility: "private" }).resolveUrl(),
		"https://cdn.test/local/carousel/25/banner.png?signed=1",
	);
});
