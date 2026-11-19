import type { Readable } from "node:stream";
import type { MediaVisibility } from "../types";

/**
 * A disk. Implementations exist for the local filesystem, Google Cloud
 * Storage and S3-compatible object stores; any object with this shape works.
 */
export interface StorageAdapter {
	exists(path: string): Promise<boolean>;
	get(path: string): Promise<Buffer>;
	getStream(path: string): Promise<Readable>;
	put(
		path: string,
		contents: Buffer | string,
		options?: StoragePutOptions,
	): Promise<boolean>;
	putStream(
		path: string,
		stream: Readable,
		options?: StoragePutOptions,
	): Promise<boolean>;
	/** Copy within the same disk. Resolves `false` when the source is missing. */
	copy(from: string, to: string): Promise<boolean>;
	move(from: string, to: string): Promise<boolean>;
	delete(path: string): Promise<boolean>;
	deleteDirectory(directory: string): Promise<boolean>;
	makeDirectory(directory: string): Promise<boolean>;
	/** Public URL of the file. */
	url(path: string): string;
	/** Time-limited URL for private files. */
	temporaryUrl(path: string, expiresInSeconds?: number): Promise<string>;
	getAdapterName(): string;
}

export interface StoragePutOptions {
	contentType?: string;
	visibility?: MediaVisibility;
	/** Cache-Control stored on the object (ignored by the local disk). */
	cacheControl?: string;
	metadata?: Record<string, string>;
}
