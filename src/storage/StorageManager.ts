import type { StorageAdapter } from "./types";

/** A disk instance, or a factory called on first use. */
export type DiskDefinition = StorageAdapter | (() => StorageAdapter);

export interface StorageManagerOptions {
	defaultDisk: string;
	disks: Record<string, DiskDefinition>;
}

/** Resolves named disks and caches the adapter for each one. */
export class StorageManager {
	private readonly defaultDisk: string;
	private readonly definitions: Record<string, DiskDefinition>;
	private readonly adapters = new Map<string, StorageAdapter>();

	constructor(options: StorageManagerOptions) {
		if (!Object.hasOwn(options.disks, options.defaultDisk)) {
			throw new Error(
				`Default disk [${options.defaultDisk}] is not defined in storage configuration`,
			);
		}

		this.defaultDisk = options.defaultDisk;
		this.definitions = options.disks;
	}

	get defaultDiskName(): string {
		return this.defaultDisk;
	}

	disk(name?: string | null): StorageAdapter {
		const diskName = name || this.defaultDisk;
		const cached = this.adapters.get(diskName);
		if (cached) {
			return cached;
		}

		if (!Object.hasOwn(this.definitions, diskName)) {
			throw new Error(
				`Disk [${diskName}] is not defined in storage configuration`,
			);
		}

		const definition = this.definitions[diskName] as DiskDefinition;
		const adapter =
			typeof definition === "function" ? definition() : definition;
		this.adapters.set(diskName, adapter);

		return adapter;
	}

	hasDisk(name: string): boolean {
		return Object.hasOwn(this.definitions, name);
	}

	getDefaultAdapter(): StorageAdapter {
		return this.disk();
	}
}
