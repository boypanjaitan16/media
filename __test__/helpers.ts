import { Sequelize } from "sequelize";
import sharp from "sharp";
import {
	createDefaultPathGenerator,
	MediaLibrary,
	type MediaLibraryOptions,
} from "../src";
import type { Media, MediaCreationAttributes } from "../src/model/Media";
import type { StorageAdapter } from "../src/storage/types";
import type { MediaStore } from "../src/store/MediaStore";

// Never connects: model definitions and `build()` work without a database.
export const sequelize = new Sequelize(
	"postgres://media:media@127.0.0.1:5432/media_test",
	{ logging: false },
);

export type StoreCall = { method: keyof MediaStore; args: unknown[] };

export const createFakeStore = (
	overrides: Partial<MediaStore> = {},
): MediaStore & { calls: StoreCall[]; created: Record<string, unknown>[] } => {
	const calls: StoreCall[] = [];
	const created: Record<string, unknown>[] = [];
	let nextId = 99;

	const record =
		<K extends keyof MediaStore>(method: K, fallback: MediaStore[K]) =>
		(...args: unknown[]) => {
			calls.push({ method, args });
			const implementation = (overrides[method] ?? fallback) as (
				...innerArgs: unknown[]
			) => unknown;
			return implementation(...args);
		};

	return {
		calls,
		created,
		create: record("create", async (attributes: MediaCreationAttributes) => {
			const media = { id: nextId++, ...attributes };
			created.push(media);
			return media as unknown as Media;
		}) as MediaStore["create"],
		findById: record("findById", async () => null) as MediaStore["findById"],
		findByOwnerUuid: record(
			"findByOwnerUuid",
			async () => null,
		) as MediaStore["findByOwnerUuid"],
		findForOwner: record(
			"findForOwner",
			async () => [],
		) as MediaStore["findForOwner"],
		findFirstForOwner: record(
			"findFirstForOwner",
			async () => null,
		) as MediaStore["findFirstForOwner"],
		findPendingConversions: record(
			"findPendingConversions",
			async () => [],
		) as MediaStore["findPendingConversions"],
		update: record("update", async () => undefined) as MediaStore["update"],
		destroy: record("destroy", async () => undefined) as MediaStore["destroy"],
	};
};

export type DiskCall = { method: string; args: unknown[] };

/** In-memory disk recording every call. */
export const createFakeDisk = (
	name = "fake",
	overrides: Partial<StorageAdapter> = {},
): StorageAdapter & { calls: DiskCall[]; files: Map<string, Buffer> } => {
	const calls: DiskCall[] = [];
	const files = new Map<string, Buffer>();

	const base: StorageAdapter = {
		exists: async (filePath) => files.has(filePath),
		get: async (filePath) => {
			const file = files.get(filePath);
			if (!file) throw new Error(`File not found: ${filePath}`);
			return file;
		},
		getStream: async () => {
			throw new Error("not implemented");
		},
		put: async (filePath, contents) => {
			files.set(filePath, Buffer.from(contents));
			return true;
		},
		putStream: async () => true,
		copy: async (from, to) => {
			const file = files.get(from);
			if (!file) return false;
			files.set(to, file);
			return true;
		},
		move: async () => true,
		delete: async (filePath) => files.delete(filePath) || true,
		deleteDirectory: async () => true,
		makeDirectory: async () => true,
		url: (filePath) => `https://cdn.test/${filePath.replace(/\\/g, "/")}`,
		temporaryUrl: async (filePath) =>
			`https://cdn.test/${filePath.replace(/\\/g, "/")}?signed=1`,
		getAdapterName: () => name,
	};

	const disk = { calls, files } as StorageAdapter & {
		calls: DiskCall[];
		files: Map<string, Buffer>;
	};
	for (const key of Object.keys(base) as Array<keyof StorageAdapter>) {
		const implementation = (overrides[key] ?? base[key]) as (
			...args: unknown[]
		) => unknown;
		(disk as unknown as Record<string, unknown>)[key] = (
			...args: unknown[]
		) => {
			calls.push({ method: key, args });
			return implementation(...args);
		};
	}

	return disk;
};

export const createTestLibrary = (
	options: Partial<Omit<MediaLibraryOptions, "store">> & {
		store?: ReturnType<typeof createFakeStore>;
	} = {},
) => {
	const store = options.store ?? createFakeStore();
	const disk = createFakeDisk("local");
	const library = new MediaLibrary({
		sequelize,
		defaultDisk: "local",
		disks: { local: disk },
		pathGenerator: createDefaultPathGenerator({ prefixedDisks: ["local"] }),
		...options,
		store,
	});

	return { library, store, disk };
};

export const createPng = (width: number, height: number) =>
	sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 20, g: 122, b: 71 },
		},
	})
		.png()
		.toBuffer();
