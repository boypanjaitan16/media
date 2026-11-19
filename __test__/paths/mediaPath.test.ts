import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";
import {
	createDefaultPathGenerator,
	getConversionFileName,
	getConversionRelativePath,
	normalizeModelType,
	parseJsonColumn,
	resolveConversionFileName,
} from "../../src";

test("default path generator uses {model-type}/{owner-id}", () => {
	const generator = createDefaultPathGenerator();

	assert.equal(
		generator.getDirectory({
			disk: "gcs",
			model_type: "Product",
			model_id: 1234,
		}),
		path.join("product", "1234"),
	);
	assert.equal(
		generator.getDirectory({
			disk: "local",
			model_type: "ProductReview",
			model_uuid: "13ab45cd",
		}),
		path.join("product-review", "13ab45cd"),
	);
});

test("default path generator prefixes configured disks with the disk name", () => {
	const generator = createDefaultPathGenerator({ prefixedDisks: ["local"] });

	assert.equal(
		generator.getDirectory({
			disk: "local",
			model_type: "Product",
			model_id: 1,
		}),
		path.join("local", "product", "1"),
	);
	assert.equal(
		generator.getDirectory({ disk: "gcs", model_type: "Product", model_id: 1 }),
		path.join("product", "1"),
	);
});

test("default path generator prefers model_uuid and strips path separators", () => {
	const generator = createDefaultPathGenerator();

	assert.equal(
		generator.getDirectory({
			model_type: "User",
			model_id: 5,
			model_uuid: "../evil/uuid",
		}),
		path.join("user", "..-evil-uuid"),
	);
});

test("normalizeModelType kebab-cases model types", () => {
	assert.equal(normalizeModelType("OrderDocument"), "order-document");
	assert.equal(normalizeModelType("  Blog Article "), "blog-article");
	assert.equal(normalizeModelType(null), "unknown");
	assert.equal(normalizeModelType("***"), "unknown");
});

test("getConversionFileName uses the conversion format extension", () => {
	assert.equal(
		getConversionFileName({
			conversionName: "w640",
			fileName: "banner.png",
			format: "webp",
		}),
		"banner-w640.webp",
	);
	assert.equal(
		getConversionFileName({
			conversionName: "w640",
			fileName: "a.png",
			format: "jpeg",
		}),
		"a-w640.jpg",
	);
	assert.equal(
		getConversionFileName({ conversionName: "thumb", fileName: "cover.jpeg" }),
		"cover-thumb.jpeg",
	);
});

test("getConversionRelativePath places conversions in a subdirectory", () => {
	assert.equal(
		getConversionRelativePath(path.join("carousel", "25"), "banner-w640.webp"),
		path.join("carousel", "25", "conversions", "banner-w640.webp"),
	);
});

test("resolveConversionFileName prefers the stored file name", () => {
	assert.equal(
		resolveConversionFileName("banner.png", "w640", {
			file_name: "banner-w640.webp",
		}),
		"banner-w640.webp",
	);
	assert.equal(
		resolveConversionFileName("banner.png", "thumb", true),
		"banner-thumb.png",
	);
});

test("parseJsonColumn returns an empty object for anything but a JSON object", () => {
	assert.deepEqual(parseJsonColumn('{"w640":{"width":640}}'), {
		w640: { width: 640 },
	});
	assert.deepEqual(parseJsonColumn({ a: 1 }), { a: 1 });
	assert.deepEqual(parseJsonColumn(null), {});
	assert.deepEqual(parseJsonColumn("not-json"), {});
	assert.deepEqual(parseJsonColumn("[1,2]"), {});
});
