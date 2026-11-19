import type { Readable } from "node:stream";
import type {
	Storage as GcsClient,
	StorageOptions as GcsClientOptions,
} from "@google-cloud/storage";
import type { StorageAdapter, StoragePutOptions } from "./types";

export interface GcsDiskConfig {
	bucket: string;
	/** Public base URL. Defaults to `https://storage.googleapis.com/<bucket>`. */
	url?: string;
	/** Options for the `@google-cloud/storage` client. Omit to use Application Default Credentials. */
	clientOptions?: GcsClientOptions;
	/** A pre-configured client; takes precedence over `clientOptions`. */
	client?: GcsClient;
}

/**
 * Google Cloud Storage disk. `@google-cloud/storage` is loaded on the first
 * operation that needs it, so importing this module stays cheap.
 */
export class GCSStorageAdapter implements StorageAdapter {
	private client?: GcsClient;
	private clientOptions?: GcsClientOptions;
	private bucket: string;
	private baseUrl: string;

	constructor(config: GcsDiskConfig) {
		if (!config.bucket) {
			throw new Error("GCS bucket name is required");
		}

		this.client = config.client;
		this.clientOptions = config.clientOptions;
		this.bucket = config.bucket;
		this.baseUrl =
			config.url || `https://storage.googleapis.com/${config.bucket}`;
	}

	private async getBucket() {
		if (!this.client) {
			const { Storage } = await import("@google-cloud/storage");
			this.client = new Storage(this.clientOptions);
		}

		return this.client.bucket(this.bucket);
	}

	private async getFile(filePath: string) {
		return (await this.getBucket()).file(this.normalizePath(filePath));
	}

	/**
	 * GCS object resource metadata: Cache-Control is a top-level field, while
	 * custom key/value pairs live under the nested `metadata` property.
	 */
	private buildObjectMetadata(options?: StoragePutOptions) {
		return {
			...(options?.cacheControl ? { cacheControl: options.cacheControl } : {}),
			...(options?.metadata ? { metadata: options.metadata } : {}),
		};
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			const [exists] = await (await this.getFile(filePath)).exists();
			return exists;
		} catch {
			return false;
		}
	}

	async get(filePath: string): Promise<Buffer> {
		try {
			const [contents] = await (await this.getFile(filePath)).download();
			return contents;
		} catch (error) {
			throw new Error(
				`Failed to get file from GCS: ${(error as Error).message}`,
			);
		}
	}

	async getStream(filePath: string): Promise<Readable> {
		return (await this.getFile(filePath)).createReadStream();
	}

	async put(
		filePath: string,
		contents: Buffer | string,
		options?: StoragePutOptions,
	): Promise<boolean> {
		try {
			await (await this.getFile(filePath)).save(contents, {
				contentType: options?.contentType,
				metadata: this.buildObjectMetadata(options),
				public: options?.visibility === "public",
			});

			return true;
		} catch (error) {
			throw new Error(`Failed to upload to GCS: ${(error as Error).message}`);
		}
	}

	async putStream(
		filePath: string,
		stream: Readable,
		options?: StoragePutOptions,
	): Promise<boolean> {
		const file = await this.getFile(filePath);

		return new Promise((resolve, reject) => {
			const writeStream = file.createWriteStream({
				contentType: options?.contentType,
				metadata: this.buildObjectMetadata(options),
				public: options?.visibility === "public",
			});

			stream
				.pipe(writeStream)
				.on("finish", () => resolve(true))
				.on("error", (err) =>
					reject(new Error(`Failed to stream to GCS: ${err.message}`)),
				);
		});
	}

	async copy(from: string, to: string): Promise<boolean> {
		try {
			const bucket = await this.getBucket();
			await bucket
				.file(this.normalizePath(from))
				.copy(bucket.file(this.normalizePath(to)));
			return true;
		} catch {
			return false;
		}
	}

	async move(from: string, to: string): Promise<boolean> {
		try {
			const bucket = await this.getBucket();
			await bucket
				.file(this.normalizePath(from))
				.move(bucket.file(this.normalizePath(to)));
			return true;
		} catch {
			return false;
		}
	}

	async delete(filePath: string): Promise<boolean> {
		try {
			await (await this.getFile(filePath)).delete({ ignoreNotFound: true });
			return true;
		} catch {
			return false;
		}
	}

	async deleteDirectory(directory: string): Promise<boolean> {
		try {
			const prefix = this.normalizePath(directory);
			const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

			await (await this.getBucket()).deleteFiles({ prefix: normalizedPrefix });

			return true;
		} catch {
			return false;
		}
	}

	/** GCS is a flat namespace; directories are implicit key prefixes. */
	async makeDirectory(_directory: string): Promise<boolean> {
		return true;
	}

	url(filePath: string): string {
		const base = this.baseUrl.endsWith("/")
			? this.baseUrl.slice(0, -1)
			: this.baseUrl;
		return `${base}/${this.normalizePath(filePath)}`;
	}

	async temporaryUrl(
		filePath: string,
		expiresInSeconds = 3600,
	): Promise<string> {
		const [signedUrl] = await (await this.getFile(filePath)).getSignedUrl({
			action: "read",
			expires: Date.now() + expiresInSeconds * 1000,
		});
		return signedUrl;
	}

	getAdapterName(): string {
		return "gcs";
	}

	private normalizePath(filePath: string): string {
		return filePath.startsWith("/") ? filePath.substring(1) : filePath;
	}
}

export const gcsDisk = (config: GcsDiskConfig): StorageAdapter =>
	new GCSStorageAdapter(config);
