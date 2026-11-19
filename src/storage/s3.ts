import { Readable } from "node:stream";
import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import type { MediaVisibility } from "../types";
import type { StorageAdapter, StoragePutOptions } from "./types";

export interface S3DiskConfig {
	bucket: string;
	region?: string;
	key?: string;
	secret?: string;
	/** Custom endpoint for S3-compatible stores (DigitalOcean Spaces, MinIO, R2). */
	endpoint?: string;
	usePathStyleEndpoint?: boolean;
	/** Public base URL. Defaults to the AWS virtual-hosted bucket URL. */
	url?: string;
	/** Default ACL visibility for writes that do not specify one. */
	visibility?: MediaVisibility;
	/** A pre-configured client; takes precedence over the credential options. */
	client?: S3Client;
}

type S3Sdk = typeof import("@aws-sdk/client-s3");

/**
 * S3-compatible disk. The AWS SDK is loaded on the first operation that needs
 * it, so importing this module stays cheap.
 */
export class S3StorageAdapter implements StorageAdapter {
	private client?: S3Client;
	private sdk?: S3Sdk;
	private clientConfig: S3ClientConfig;
	private bucket: string;
	private baseUrl: string;
	private visibility: MediaVisibility;

	constructor(config: S3DiskConfig) {
		if (!config.bucket) {
			throw new Error("S3 bucket name is required");
		}

		this.clientConfig = {
			region: config.region || "us-east-1",
			endpoint: config.endpoint,
			forcePathStyle: config.usePathStyleEndpoint || false,
			// Without explicit credentials the SDK resolves them itself (IAM role, env)
			...(config.key && config.secret
				? {
						credentials: {
							accessKeyId: config.key,
							secretAccessKey: config.secret,
						},
					}
				: {}),
		};
		this.client = config.client;
		this.bucket = config.bucket;
		this.baseUrl =
			config.url ||
			`https://${this.bucket}.s3.${config.region || "us-east-1"}.amazonaws.com`;
		this.visibility = config.visibility || "private";
	}

	private async load(): Promise<{ client: S3Client; sdk: S3Sdk }> {
		if (!this.sdk) {
			this.sdk = await import("@aws-sdk/client-s3");
		}
		if (!this.client) {
			this.client = new this.sdk.S3Client(this.clientConfig);
		}

		return { client: this.client, sdk: this.sdk };
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			await client.send(
				new sdk.HeadObjectCommand({
					Bucket: this.bucket,
					Key: this.normalizePath(filePath),
				}),
			);
			return true;
		} catch {
			return false;
		}
	}

	async get(filePath: string): Promise<Buffer> {
		try {
			const body = await this.getStream(filePath);
			const chunks: Buffer[] = [];
			for await (const chunk of body) {
				chunks.push(Buffer.from(chunk));
			}

			return Buffer.concat(chunks);
		} catch (error) {
			throw new Error(
				`Failed to get file from S3: ${(error as Error).message}`,
			);
		}
	}

	async getStream(filePath: string): Promise<Readable> {
		try {
			const { client, sdk } = await this.load();
			const response = await client.send(
				new sdk.GetObjectCommand({
					Bucket: this.bucket,
					Key: this.normalizePath(filePath),
				}),
			);

			if (response.Body instanceof Readable) {
				return response.Body;
			}
			throw new Error("S3 response body is not a readable stream");
		} catch (error) {
			throw new Error(
				`Failed to get stream from S3: ${(error as Error).message}`,
			);
		}
	}

	async put(
		filePath: string,
		contents: Buffer | string,
		options?: StoragePutOptions,
	): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			await client.send(
				new sdk.PutObjectCommand({
					Bucket: this.bucket,
					Key: this.normalizePath(filePath),
					Body: contents,
					ContentType: options?.contentType,
					CacheControl: options?.cacheControl,
					ACL: this.getAcl(options?.visibility),
					Metadata: options?.metadata,
				}),
			);

			return true;
		} catch (error) {
			throw new Error(`Failed to upload to S3: ${(error as Error).message}`);
		}
	}

	async putStream(
		filePath: string,
		stream: Readable,
		options?: StoragePutOptions,
	): Promise<boolean> {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(Buffer.from(chunk));
		}

		return this.put(filePath, Buffer.concat(chunks), options);
	}

	async copy(from: string, to: string): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			await client.send(
				new sdk.CopyObjectCommand({
					Bucket: this.bucket,
					CopySource: `${this.bucket}/${this.normalizePath(from)}`,
					Key: this.normalizePath(to),
					ACL: this.getAcl(),
				}),
			);

			return true;
		} catch {
			return false;
		}
	}

	async move(from: string, to: string): Promise<boolean> {
		if (!(await this.copy(from, to))) {
			return false;
		}

		return this.delete(from);
	}

	async delete(filePath: string): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			await client.send(
				new sdk.DeleteObjectCommand({
					Bucket: this.bucket,
					Key: this.normalizePath(filePath),
				}),
			);

			return true;
		} catch {
			return false;
		}
	}

	async deleteDirectory(directory: string): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			const prefix = this.normalizePath(directory);
			const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

			const response = await client.send(
				new sdk.ListObjectsV2Command({
					Bucket: this.bucket,
					Prefix: normalizedPrefix,
				}),
			);

			const objectsToDelete = (response.Contents ?? [])
				.filter((object) => object.Key)
				.map((object) => ({ Key: object.Key as string }));

			if (objectsToDelete.length === 0) {
				return true;
			}

			await client.send(
				new sdk.DeleteObjectsCommand({
					Bucket: this.bucket,
					Delete: { Objects: objectsToDelete },
				}),
			);

			// Listing is paginated; keep going until the prefix is empty
			if (response.IsTruncated) {
				return this.deleteDirectory(directory);
			}

			return true;
		} catch {
			return false;
		}
	}

	/** Writes an empty `dir/` marker object. */
	async makeDirectory(directory: string): Promise<boolean> {
		try {
			const { client, sdk } = await this.load();
			const dirPath = this.normalizePath(directory);

			await client.send(
				new sdk.PutObjectCommand({
					Bucket: this.bucket,
					Key: dirPath.endsWith("/") ? dirPath : `${dirPath}/`,
					Body: "",
					ACL: this.getAcl(),
				}),
			);

			return true;
		} catch {
			return false;
		}
	}

	url(filePath: string): string {
		const baseUrl = this.baseUrl.endsWith("/")
			? this.baseUrl.slice(0, -1)
			: this.baseUrl;

		return `${baseUrl}/${this.normalizePath(filePath)}`;
	}

	async temporaryUrl(
		filePath: string,
		expiresInSeconds = 3600,
	): Promise<string> {
		const { client, sdk } = await this.load();
		const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
		const command = new sdk.GetObjectCommand({
			Bucket: this.bucket,
			Key: this.normalizePath(filePath),
		});

		// The presigner and client packages may resolve different @smithy versions
		return getSignedUrl(
			client as unknown as Parameters<typeof getSignedUrl>[0],
			command as unknown as Parameters<typeof getSignedUrl>[1],
			{ expiresIn: expiresInSeconds },
		);
	}

	getAdapterName(): string {
		return "s3";
	}

	private normalizePath(filePath: string): string {
		const withoutLeadingSlash = filePath.startsWith("/")
			? filePath.substring(1)
			: filePath;

		return withoutLeadingSlash.replace(/\\/g, "/");
	}

	private getAcl(visibility?: MediaVisibility): "public-read" | undefined {
		// Objects are private unless an ACL is given
		return (visibility || this.visibility) === "public"
			? "public-read"
			: undefined;
	}
}

export const s3Disk = (config: S3DiskConfig): StorageAdapter =>
	new S3StorageAdapter(config);
