import type { MediaLibrary } from "../MediaLibrary";
import type { Media } from "../model/Media";
import type { AddMediaOptions, MediaFile, MediaOwner } from "../types";

abstract class AddMediaBuilder {
	protected options: AddMediaOptions = {};

	toMediaCollection(name: string) {
		this.options.collection = name;
		return this;
	}

	toDisk(disk: string) {
		this.options.disk = disk;
		return this;
	}

	usingFileName(name: string) {
		this.options.fileName = name;
		return this;
	}

	withCustomProperties(properties: Record<string, unknown>) {
		this.options.customProperties = properties;
		return this;
	}

	withOrder(order: number) {
		this.options.order = order;
		return this;
	}

	abstract save(): Promise<Media>;
}

/** `library.add(owner, file).toMediaCollection("x").save()` */
export class AttachMediaBuilder extends AddMediaBuilder {
	constructor(
		private readonly library: MediaLibrary,
		private readonly owner: MediaOwner,
		private readonly file: MediaFile,
	) {
		super();
	}

	save(): Promise<Media> {
		return this.library.addMedia(this.owner, this.file, this.options);
	}
}

/** `library.addFromUrl(owner, url).toMediaCollection("x").save()` */
export class AttachMediaFromUrlBuilder extends AddMediaBuilder {
	constructor(
		private readonly library: MediaLibrary,
		private readonly owner: MediaOwner,
		private readonly url: string,
	) {
		super();
	}

	save(): Promise<Media> {
		return this.library.addMediaFromUrl(this.owner, this.url, this.options);
	}
}

/** `library.copy(owner, mediaId).toMediaCollection("x").save()` */
export class CopyMediaBuilder {
	private collection?: string;

	constructor(
		private readonly library: MediaLibrary,
		private readonly owner: MediaOwner,
		private readonly mediaId: number,
	) {}

	toMediaCollection(name: string) {
		this.collection = name;
		return this;
	}

	save(): Promise<Media> {
		return this.library.copyMedia(this.owner, this.mediaId, this.collection);
	}
}
