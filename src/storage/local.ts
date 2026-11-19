import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StorageAdapter, StoragePutOptions } from "./types";

export interface LocalDiskConfig {
	/** Root directory; relative paths resolve against `process.cwd()`. */
	root: string;
	/** Base URL the root directory is served from. */
	url?: string;
}

/** Local filesystem disk. */
export class LocalStorageAdapter implements StorageAdapter {
	private rootPath: string;
	private baseUrl: string;

	constructor(config: LocalDiskConfig) {
		const rootPath = config.root?.trim();
		if (!rootPath) {
			throw new Error("Local storage disk config requires a root path");
		}
		this.rootPath = path.isAbsolute(rootPath)
			? rootPath
			: path.resolve(process.cwd(), rootPath);
		this.baseUrl = config.url || "";
	}

	private getFullPath(filePath: string): string {
		return path.join(this.rootPath, filePath);
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.access(this.getFullPath(filePath));
			return true;
		} catch {
			return false;
		}
	}

	async get(filePath: string): Promise<Buffer> {
		return await fs.readFile(this.getFullPath(filePath));
	}

	async getStream(filePath: string): Promise<Readable> {
		// Check first so a missing file rejects instead of emitting an unhandled error
		if (!(await this.exists(filePath))) {
			throw new Error(`File not found: ${filePath}`);
		}

		return createReadStream(this.getFullPath(filePath));
	}

	async put(
		filePath: string,
		contents: Buffer | string,
		_options?: StoragePutOptions,
	): Promise<boolean> {
		await this.makeDirectory(path.dirname(filePath));

		try {
			await fs.writeFile(this.getFullPath(filePath), contents);
			return true;
		} catch {
			return false;
		}
	}

	async putStream(
		filePath: string,
		stream: Readable,
		_options?: StoragePutOptions,
	): Promise<boolean> {
		await this.makeDirectory(path.dirname(filePath));

		try {
			await pipeline(stream, createWriteStream(this.getFullPath(filePath)));
			return true;
		} catch {
			return false;
		}
	}

	async copy(from: string, to: string): Promise<boolean> {
		await this.makeDirectory(path.dirname(to));

		try {
			await fs.copyFile(this.getFullPath(from), this.getFullPath(to));
			return true;
		} catch {
			return false;
		}
	}

	async move(from: string, to: string): Promise<boolean> {
		const sourcePath = this.getFullPath(from);
		const destPath = this.getFullPath(to);

		await this.makeDirectory(path.dirname(to));

		try {
			await fs.rename(sourcePath, destPath);
			return true;
		} catch {
			// rename fails across devices; fall back to copy + delete
			try {
				await fs.copyFile(sourcePath, destPath);
				await fs.unlink(sourcePath);
				return true;
			} catch {
				return false;
			}
		}
	}

	async delete(filePath: string): Promise<boolean> {
		try {
			await fs.unlink(this.getFullPath(filePath));
			return true;
		} catch {
			return false;
		}
	}

	async deleteDirectory(directory: string): Promise<boolean> {
		try {
			await fs.rm(this.getFullPath(directory), {
				recursive: true,
				force: true,
			});
			return true;
		} catch {
			return false;
		}
	}

	async makeDirectory(directory: string): Promise<boolean> {
		try {
			await fs.mkdir(this.getFullPath(directory), { recursive: true });
			return true;
		} catch {
			return false;
		}
	}

	url(filePath: string): string {
		const normalizedPath = filePath.replace(/\\/g, "/");
		const baseUrl = this.baseUrl.endsWith("/")
			? this.baseUrl.slice(0, -1)
			: this.baseUrl;

		// Paths may still carry the conventional storage root; strip it so the
		// URL is relative to the served root.
		let cleanPath = normalizedPath;
		const prefixesToRemove = [
			"storage/media/",
			"storage/media",
			"storage/local/",
			"storage/local",
		];

		for (const prefix of prefixesToRemove) {
			if (cleanPath.startsWith(prefix)) {
				cleanPath = cleanPath.substring(prefix.length);
				break;
			}
		}

		const pathWithLeadingSlash = cleanPath.startsWith("/")
			? cleanPath
			: `/${cleanPath}`;

		return `${baseUrl}${pathWithLeadingSlash}`;
	}

	/** The local disk has no signed URLs; returns the regular URL. */
	async temporaryUrl(
		filePath: string,
		_expiresInSeconds?: number,
	): Promise<string> {
		return this.url(filePath);
	}

	getAdapterName(): string {
		return "local";
	}
}

export const localDisk = (config: LocalDiskConfig): StorageAdapter =>
	new LocalStorageAdapter(config);
