# @boyboni/media

Associate files with your [Sequelize](https://sequelize.org) models. Media are grouped in named collections, stored on pluggable disks (local filesystem, Google Cloud Storage, S3-compatible), and images can get responsive conversions generated with [sharp](https://sharp.pixelplumbing.com).

Inspired by [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary).

> **Status:** incubating inside the MySawit monorepo. The API may still change before the first public release.

## Install

```sh
npm install @boyboni/media sequelize
# optional peers, install what you use
npm install sharp                    # image conversions
npm install @google-cloud/storage    # gcs disk
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner  # s3 disk
```

Optional SDKs load on first use, so importing the library stays cheap.

## Set up

```ts
import { createMediaLibrary, widthConversions } from "@boyboni/media";
import { gcsDisk } from "@boyboni/media/storage/gcs";
import { localDisk } from "@boyboni/media/storage/local";

export const media = createMediaLibrary({
	sequelize,
	tableName: "media",
	defaultDisk: "local",
	disks: {
		local: localDisk({ root: "./storage/media", url: "/media" }),
		// a factory defers creating the disk until it is first used
		gcs: () => gcsDisk({ bucket: process.env.GCS_BUCKET! }),
	},
	collections: {
		Product: {
			gallery: { conversions: widthConversions([320, 640, 1024]), immutableCache: true },
		},
		User: {
			id_card: { visibility: "private" },
		},
	},
	logger: console,
});
```

The table needs these columns:

| column | type |
| --- | --- |
| `id` | bigint, primary key |
| `model_type` | string |
| `model_id` | bigint, nullable |
| `model_uuid` | uuid, nullable |
| `collection_name`, `name`, `file_name`, `disk` | string |
| `mime_type`, `conversions_disk` | string, nullable |
| `size`, `order_column` | integer |
| `manipulations`, `custom_properties`, `generated_conversions`, `responsive_images` | text (JSON) |
| `visibility` | string(10), default `public` |
| `created_at`, `updated_at` | timestamp |

## Owners

Any object with an `id` and a `getModelType()` method can own media. Numeric ids are stored in `model_id`, anything else in `model_uuid`.

```ts
class Product extends Model {
	getModelType() {
		return "Product";
	}
}

media.registerOwner(Product, { modelType: "Product", key: "uuid", as: "media" });
```

`registerOwner` adds `Product.hasMany(Media)` scoped to the owner type, so `Product.findAll({ include: "media" })` works.

## Adding media

```ts
await media.add(product, file).toMediaCollection("gallery").save();

await media
	.addFromUrl(user, avatarUrl)
	.toMediaCollection("avatar")
	.usingFileName(`${user.id}.jpg`)
	.save();

await media.copy(orderDocument, sourceMediaId).toMediaCollection("id_card").save();
```

`file` is an in-memory file (`{ buffer, originalname, mimetype, size }`), which is what multer's memory storage gives you. `addFromUrl` downloads whatever URL it receives, so only pass URLs you trust.

## Reading media

```ts
const items = await media.getMedia(product, "gallery");
const first = await media.getFirstMedia(product, "gallery");

first?.url; // public URL of the original
first?.getUrl({ conversion: "w640" });
first?.getVariants(); // [{ name, url, width, height, format }], smallest first
await first?.resolveUrl(); // temporary signed URL for private media
```

## Collections

| option | effect |
| --- | --- |
| `visibility` | `"public"` (default) or `"private"`. Private files are stored without a public ACL and have no variants. |
| `disk` | disk used when the caller does not pick one |
| `conversions` | image conversions for public JPEG/PNG/WebP media |
| `immutableCache` | public files get `Cache-Control: public, max-age=31536000, immutable` and a content hash in their file name |

## Conversions

Conversions are generated right after upload. When one fails, the attempt is counted in `custom_properties.conversion_attempts` and the upload is kept. To backfill or retry, run a periodic job:

```ts
const pending = await media.findPendingConversions({ afterId, limit: 50 });
for (const item of pending) {
	if (media.shouldRetryConversions(item)) {
		await media.generateConversions(item);
	}
}
```

## Paths

Files are stored at `{model-type}/{owner-id}/{file_name}`, with conversions in `conversions/`. Pass `createDefaultPathGenerator({ prefixedDisks: ["local"] })` to prefix some disks with their name, or provide your own `PathGenerator`. Its optional `getFallbackDirectories` lists older locations to try when copying media.

## Upload validation

`matchesMimeSignature(buffer, mimeType)` checks the leading magic bytes of PDF, JPEG and PNG files, so you can reject uploads whose content does not match their declared type.

## License

MIT
