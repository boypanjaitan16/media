# @boyboni/media

[![npm](https://img.shields.io/npm/v/@boyboni/media)](https://www.npmjs.com/package/@boyboni/media)
[![CI](https://github.com/boypanjaitan16/media/actions/workflows/ci.yml/badge.svg)](https://github.com/boypanjaitan16/media/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@boyboni/media)](LICENSE)

Attach files to your [Sequelize](https://sequelize.org) models. Files are grouped in named collections and stored on pluggable disks: local filesystem, Google Cloud Storage, or anything S3-compatible. Images can also get responsive conversions made with [sharp](https://sharp.pixelplumbing.com).

Inspired by [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary).

```ts
await media.addMedia(product, file).toMediaCollection("gallery");

const image = await media.getFirstMedia(product, "gallery");
image?.getUrl({ conversion: "w640" });
```

> **Status:** pre-1.0. The API can still change between minor versions.

## Features

- Polymorphic owners: any model can own media, keyed by a numeric id or a UUID.
- Named collections with per-collection rules: visibility, disk, accepted MIME types, maximum size, and single-file replacement.
- Local, Google Cloud Storage and S3 (or S3-compatible) disks. A disk's SDK loads only when that disk is first used.
- Private media served through temporary signed URLs.
- Responsive image conversions (for example `w320`, `w640` in webp), generated on upload, with a retry helper for backfills.
- Content-hashed file names and an immutable `Cache-Control` header for CDN-friendly collections.
- A magic-byte check to catch uploads that claim the wrong MIME type.

## Install

```sh
npm install @boyboni/media sequelize
```

Then install the optional peers for the features you use:

```sh
npm install sharp                                              # image conversions
npm install @google-cloud/storage                              # gcs disk
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner   # s3 disk
```

Requires Node.js 20 or later and Sequelize 6.

## Create the table

Add a migration that calls `createMediaTable`. It creates the table and its owner lookup indexes.

```js
// migrations/20260101000000-create-media.js
const { createMediaTable, dropMediaTable } = require("@boyboni/media");

module.exports = {
	up: (queryInterface) => createMediaTable(queryInterface),
	down: (queryInterface) => dropMediaTable(queryInterface),
};
```

The table is named `media` by default. To use another name, pass `{ tableName: "..." }` to both functions and to `createMediaLibrary`.

## Set up

Create one library instance and share it across your app.

```ts
import { createMediaLibrary, widthConversions } from "@boyboni/media";
import { gcsDisk } from "@boyboni/media/storage/gcs";
import { localDisk } from "@boyboni/media/storage/local";

export const media = createMediaLibrary({
	sequelize,
	defaultDisk: "local",
	disks: {
		local: localDisk({ root: "./storage/media", url: "/media" }),
		// A factory creates the disk the first time it is used
		gcs: () => gcsDisk({ bucket: process.env.GCS_BUCKET! }),
	},
	collections: {
		Product: {
			cover: {
				singleFile: true,
				acceptsMimeTypes: ["image/*"],
				conversions: widthConversions([320, 640, 1024]),
				immutableCache: true,
			},
			gallery: { conversions: widthConversions([320, 640, 1024]) },
		},
		User: {
			avatar: { singleFile: true, maxFileSize: 2 * 1024 * 1024 },
			id_card: { visibility: "private", disk: "gcs" },
		},
	},
	logger: console,
});
```

If `defaultDisk` names a disk that isn't configured, `createMediaLibrary` throws right away.

## Owners

Any object with an `id` and a `getModelType()` method can own media. Numeric ids go in `model_id`; any other id, such as a UUID, goes in `model_uuid`.

```ts
class Product extends Model {
	getModelType() {
		return "Product";
	}
}

media.registerOwner(Product, { modelType: "Product", key: "uuid", as: "media" });
```

`registerOwner` adds `Product.hasMany(media.Media)`, scoped to the owner type, so `Product.findAll({ include: "media" })` works.

## Adding media

Start with `addMedia`, `addMediaFromUrl` or `copyMedia`, chain any options, and finish with `toMediaCollection`, which stores the file and returns the saved `Media`.

```ts
await media.addMedia(product, file).toMediaCollection("gallery");

await media
	.addMediaFromUrl(user, avatarUrl)
	.usingFileName(`${user.id}.jpg`)
	.toMediaCollection("avatar");

await media.copyMedia(orderDocument, sourceMediaId).toMediaCollection("id_card");
```

| method | effect |
| --- | --- |
| `usingFileName(name)` | store under this name instead of the original (it is still sanitized) |
| `toDisk(name)` | override the collection's or the library's default disk |
| `withCustomProperties(object)` | saved in `custom_properties` |
| `withOrder(number)` | saved in `order_column` (default `0`) |

`file` is an in-memory file (`{ buffer, originalname, mimetype, size }`), which is what multer's memory storage produces. Calling `toMediaCollection()` with no name stores the file in the `defaultCollection` (`"default"`).

`addMediaFromUrl` downloads whatever URL it is given. Only pass URLs you trust.

## Collections

| option | effect |
| --- | --- |
| `visibility` | `"public"` (default) or `"private"`. Private files are stored without a public ACL, are served through signed URLs, and get no conversions. |
| `disk` | disk to use when the caller doesn't pick one |
| `singleFile` | keep one item per owner. The previous items are deleted after the new one is stored, so a failed upload keeps the old file. |
| `acceptsMimeTypes` | accepted types, exact (`"application/pdf"`) or wildcard (`"image/*"`) |
| `maxFileSize` | maximum size in bytes |
| `conversions` | image conversions for public JPEG, PNG and WebP files |
| `immutableCache` | public files get `Cache-Control: public, max-age=31536000, immutable` and a content hash in their file name |

You can also register collections later with `media.defineCollections("Product", { ... })`.

## Errors

A file rejected by `acceptsMimeTypes` or `maxFileSize` throws a `MediaValidationError` before anything is written. Remote files are checked against their `Content-Type` and `Content-Length` headers before the body is downloaded.

```ts
import { MediaValidationError } from "@boyboni/media";

try {
	await media.addMedia(user, file).toMediaCollection("avatar");
} catch (error) {
	if (error instanceof MediaValidationError && error.code === "FILE_TOO_LARGE") {
		// error.size, error.maxFileSize, error.collection, ...
	}
}
```

`code` is `"MIME_TYPE_NOT_ACCEPTED"` or `"FILE_TOO_LARGE"`, so you can show your own, localized message. `copyMedia` throws `MediaNotFoundError` when the source item doesn't exist. Both extend `MediaError`.

## Reading media

```ts
const items = await media.getMedia(product, "gallery"); // ordered by order_column
const first = await media.getFirstMedia(product, "gallery");
const item = await media.findMedia(42);

first?.url; // public URL of the original
first?.getUrl({ conversion: "w640" });
first?.getUrls(); // { original, conversions: { w320, w640, ... } }
first?.getVariants(); // [{ name, url, width, height, format }], smallest first
await first?.resolveUrl(); // signed URL (1 hour) for private media, public URL otherwise
```

## Updating and deleting

```ts
await media.updateCustomProperties(42, { alt: "Front view" }); // shallow merge
await media.setNewOrder([7, 3, 9]); // order_column becomes 1, 2, 3
await media.deleteMedia(42); // the file, its conversions and the row
await media.clearMediaCollection(product, "gallery");
```

These methods return `false` instead of throwing when something goes wrong, and log the cause.

## Conversions

`widthConversions([320, 640])` creates webp conversions named `w320` and `w640` that fit inside each width and never upscale. You can also write `MediaConversionSettings` directly (`name`, `width`, `height`, `format`, `quality`, `fit`).

Conversions are generated right after an upload. If one fails, the upload is kept and the failure is counted in `custom_properties.conversion_attempts`. To backfill or retry, run a periodic job:

```ts
let afterId = 0;
for (;;) {
	const pending = await media.findPendingConversions({ afterId, limit: 50 });
	if (pending.length === 0) break;

	for (const item of pending) {
		if (media.shouldRetryConversions(item)) {
			await media.generateConversions(item);
		}
	}
	afterId = pending[pending.length - 1].id;
}
```

`shouldRetryConversions` gives up after `conversionMaxAttempts` failed attempts (default `3`).

## Disks

| import | config |
| --- | --- |
| `localDisk` from `@boyboni/media/storage/local` | `root` (directory), `url` (public base URL) |
| `gcsDisk` from `@boyboni/media/storage/gcs` | `bucket`, `url?`, `clientOptions?` or `client?` |
| `s3Disk` from `@boyboni/media/storage/s3` | `bucket`, `region?`, `key?`, `secret?`, `endpoint?`, `usePathStyleEndpoint?`, `url?`, `visibility?`, `client?` |

Set `endpoint` to use S3-compatible stores such as Cloudflare R2, MinIO or DigitalOcean Spaces. To write your own disk, implement `StorageAdapter`. `media.storage.disk(name)` gives you any configured disk for direct file access.

## Paths

Files are stored at `{model-type}/{owner-id}/{file_name}`, and conversions under `conversions/` in the same directory. To prefix some disks with their own name, pass `createDefaultPathGenerator({ prefixedDisks: ["local"] })` as `pathGenerator`, or provide your own `PathGenerator`. Its optional `getFallbackDirectories` lists older locations that `copyMedia` tries when a file has moved.

## Upload validation

`matchesMimeSignature(buffer, mimeType)` checks the first bytes of PDF, JPEG and PNG files, so you can reject uploads whose content doesn't match their declared type. Other types always pass.

```ts
import { matchesMimeSignature } from "@boyboni/media";

if (!matchesMimeSignature(file.buffer, file.mimetype)) {
	throw new Error("File content does not match its type");
}
```

## Contributing

Issues and pull requests are welcome. Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages; releases and the changelog are generated from them.

```sh
pnpm install
pnpm run lint && pnpm run check-types && pnpm test && pnpm run build
```

## License

[MIT](LICENSE)
