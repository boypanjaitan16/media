import type { MediaLibrary } from "../MediaLibrary";
import type { Media } from "../model/Media";
import type { AddMediaOptions, MediaFile, MediaOwner } from "../types";

type FileAdderSource =
	| { type: "file"; file: MediaFile }
	| { type: "url"; url: string };

/**
 * Collects options for a new media item. `toMediaCollection()` stores it.
 *
 * ```ts
 * await media.addMedia(product, file).usingFileName("a.jpg").toMediaCollection("gallery");
 * ```
 */
export class FileAdder {
	private readonly options: Omit<AddMediaOptions, "collection"> = {};

	/** @internal Use `MediaLibrary.addMedia` or `addMediaFromUrl`. */
	constructor(
		private readonly library: MediaLibrary,
		private readonly owner: MediaOwner,
		private readonly source: FileAdderSource,
	) {}

	/** Store on this disk instead of the collection or library default. */
	toDisk(disk: string): this {
		this.options.disk = disk;
		return this;
	}

	/** Store under this name instead of the original one (it is still sanitized). */
	usingFileName(fileName: string): this {
		this.options.fileName = fileName;
		return this;
	}

	withCustomProperties(properties: Record<string, unknown>): this {
		this.options.customProperties = properties;
		return this;
	}

	/** Value for `order_column`. Defaults to `0`. */
	withOrder(order: number): this {
		this.options.order = order;
		return this;
	}

	/** Store the file in `collection` (or the default collection) and return the saved media. */
	toMediaCollection(collection?: string): Promise<Media> {
		const options: AddMediaOptions = { ...this.options, collection };

		return this.source.type === "file"
			? this.library.storeFile(this.owner, this.source.file, options)
			: this.library.storeFromUrl(this.owner, this.source.url, options);
	}
}

/**
 * Duplicates an existing media item onto another owner.
 *
 * ```ts
 * await media.copyMedia(orderDocument, mediaId).toMediaCollection("id_card");
 * ```
 */
export class MediaCopier {
	/** @internal Use `MediaLibrary.copyMedia`. */
	constructor(
		private readonly library: MediaLibrary,
		private readonly owner: MediaOwner,
		private readonly mediaId: number,
	) {}

	/**
	 * Copy into `collection`, or into the source's collection when omitted. With
	 * a collection, the copy's file name is prefixed with `{collection}-{sourceId}-`.
	 */
	toMediaCollection(collection?: string): Promise<Media> {
		return this.library.duplicate(this.owner, this.mediaId, collection);
	}
}
