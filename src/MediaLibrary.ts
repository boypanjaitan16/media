import { createHash } from "node:crypto";
import path from "node:path";
import type { Model, ModelStatic, Sequelize } from "sequelize";
import {
	AttachMediaBuilder,
	AttachMediaFromUrlBuilder,
	CopyMediaBuilder,
} from "./builders/builders";
import {
	CONVERSION_CONTENT_TYPES,
	CONVERTIBLE_IMAGE_MIME_TYPES,
	renderConversion,
} from "./conversions/conversions";
import {
	initMediaModel,
	Media,
	type MediaCreationAttributes,
} from "./model/Media";
import {
	createDefaultPathGenerator,
	getConversionFileName,
	getConversionRelativePath,
	type MediaPathSubject,
	type PathGenerator,
	parseJsonColumn,
	resolveConversionFileName,
} from "./paths/mediaPath";
import { type DiskDefinition, StorageManager } from "./storage/StorageManager";
import {
	createSequelizeMediaStore,
	type MediaOwnerReference,
	type MediaStore,
} from "./store/MediaStore";
import {
	type AddMediaOptions,
	type MediaCollectionDefinition,
	type MediaConversionSettings,
	type MediaFile,
	type MediaGeneratedConversion,
	type MediaLogger,
	type MediaOwner,
	noopLogger,
} from "./types";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const DEFAULT_CONVERSION_MAX_ATTEMPTS = 3;

export interface MediaLibraryOptions {
	sequelize: Sequelize;
	/** Named disks. Pass a factory to defer creating a disk until it is used. */
	disks: Record<string, DiskDefinition>;
	defaultDisk: string;
	/** Collection used when none is given. Defaults to `"default"`. */
	defaultCollection?: string;
	/** Defaults to `"media"`. */
	tableName?: string;
	modelName?: string;
	/** A subclass of `Media` to initialize instead of the base class. */
	model?: typeof Media;
	/** Defaults to `{model-type}/{owner-id}/`. */
	pathGenerator?: PathGenerator;
	logger?: MediaLogger;
	/** Collections per owner type, same as calling `defineCollections`. */
	collections?: Record<string, Record<string, MediaCollectionDefinition>>;
	/** Cache-Control for public files in `immutableCache` collections. */
	immutableCacheControl?: string;
	/** Failed conversion attempts after which `shouldRetryConversions` gives up. */
	conversionMaxAttempts?: number;
	/** Persistence override; defaults to the Sequelize model. */
	store?: MediaStore;
}

export interface RegisterOwnerOptions {
	/** Value stored in `model_type`; must match the owner's `getModelType()`. */
	modelType: string;
	/** Owner key column: numeric `model_id` (default) or `model_uuid`. */
	key?: "id" | "uuid";
	/** Association alias on the owner. Defaults to `"media"`. */
	as?: string;
	/** Association alias on `Media` back to the owner. Defaults to the lower-cased model type. */
	inverseAs?: string;
}

const sanitizeFileName = (fileName: string) => {
	const sanitized = fileName
		.replace(/\s+/g, "_")
		.replace(/[^\w\s.-]/g, "")
		.toLowerCase();

	// Never let a name like ".." resolve outside the owner directory
	return /^\.*$/.test(sanitized) ? "file" : sanitized;
};

/** Append a short content hash so long-cached objects get a unique key. */
const withContentHash = (fileName: string, contents: Buffer) => {
	const { name, ext } = path.parse(fileName);
	const hash = createHash("sha256").update(contents).digest("hex");

	return `${name}-${hash.slice(0, 10)}${ext}`;
};

const toOwnerReference = (owner: MediaOwner): MediaOwnerReference => {
	const isNumericId = typeof owner.id === "number";

	return {
		model_type: owner.getModelType(),
		model_id: isNumericId ? (owner.id as number) : null,
		model_uuid: isNumericId ? null : String(owner.id),
	};
};

const fileNameFromUrl = (url: string) => {
	try {
		return path.basename(new URL(url).pathname) || "file";
	} catch {
		return "file";
	}
};

export class MediaLibrary {
	readonly Media: typeof Media;
	readonly storage: StorageManager;
	readonly pathGenerator: PathGenerator;
	readonly defaultCollection: string;

	private readonly store: MediaStore;
	private readonly logger: MediaLogger;
	private readonly immutableCacheControl: string;
	private readonly conversionMaxAttempts: number;
	private readonly collections = new Map<
		string,
		Map<string, MediaCollectionDefinition>
	>();

	constructor(options: MediaLibraryOptions) {
		this.storage = new StorageManager({
			defaultDisk: options.defaultDisk,
			disks: options.disks,
		});
		this.pathGenerator = options.pathGenerator ?? createDefaultPathGenerator();
		this.defaultCollection = options.defaultCollection ?? "default";
		this.logger = options.logger ?? noopLogger;
		this.immutableCacheControl =
			options.immutableCacheControl ?? IMMUTABLE_CACHE_CONTROL;
		this.conversionMaxAttempts =
			options.conversionMaxAttempts ?? DEFAULT_CONVERSION_MAX_ATTEMPTS;

		this.Media = initMediaModel(options.model ?? Media, {
			sequelize: options.sequelize,
			tableName: options.tableName,
			modelName: options.modelName,
			context: { storage: this.storage, pathGenerator: this.pathGenerator },
		});
		this.store = options.store ?? createSequelizeMediaStore(this.Media);

		for (const [modelType, definitions] of Object.entries(
			options.collections ?? {},
		)) {
			this.defineCollections(modelType, definitions);
		}
	}

	// ---------------------------------------------------------------------------
	// Collections and owners
	// ---------------------------------------------------------------------------

	/** Register (or extend) the collections of an owner type. */
	defineCollections(
		modelType: string,
		definitions: Record<string, MediaCollectionDefinition>,
	): this {
		const existing =
			this.collections.get(modelType) ??
			new Map<string, MediaCollectionDefinition>();

		for (const [name, definition] of Object.entries(definitions)) {
			existing.set(name, { ...existing.get(name), ...definition });
		}
		this.collections.set(modelType, existing);

		return this;
	}

	getCollection(
		modelType?: null | string,
		collectionName?: null | string,
	): MediaCollectionDefinition | undefined {
		if (!modelType || !collectionName) {
			return undefined;
		}

		return this.collections.get(modelType)?.get(collectionName);
	}

	getConversions(
		modelType?: null | string,
		collectionName?: null | string,
	): MediaConversionSettings[] {
		return this.getCollection(modelType, collectionName)?.conversions ?? [];
	}

	/** `owner.hasMany(Media)` scoped to the owner type, plus the inverse `belongsTo`. */
	registerOwner(
		OwnerModel: ModelStatic<Model>,
		{ modelType, key = "id", as = "media", inverseAs }: RegisterOwnerOptions,
	): void {
		const foreignKey = key === "uuid" ? "model_uuid" : "model_id";

		OwnerModel.hasMany(this.Media, {
			as,
			foreignKey,
			constraints: false,
			scope: { model_type: modelType },
		});
		this.Media.belongsTo(OwnerModel, {
			as: inverseAs ?? modelType.toLowerCase(),
			foreignKey,
			constraints: false,
		});
	}

	// ---------------------------------------------------------------------------
	// Paths and cache headers
	// ---------------------------------------------------------------------------

	getDirectory(media: MediaPathSubject): string {
		return this.pathGenerator.getDirectory(media);
	}

	getPath(media: MediaPathSubject & { file_name: string }): string {
		return path.join(this.getDirectory(media), media.file_name);
	}

	getConversionPath(
		media: MediaPathSubject & {
			file_name: string;
			generated_conversions?: null | string;
		},
		conversionName: string,
	): string {
		const generatedConversions = parseJsonColumn(media.generated_conversions);

		return getConversionRelativePath(
			this.getDirectory(media),
			resolveConversionFileName(
				media.file_name,
				conversionName,
				generatedConversions[conversionName],
			),
		);
	}

	/**
	 * Cache-Control for a stored object, or `undefined` to keep the disk default.
	 */
	getCacheControl(media: {
		model_type?: null | string;
		collection_name?: null | string;
		visibility?: null | string;
	}): string | undefined {
		return media.visibility !== "private" &&
			this.getCollection(media.model_type, media.collection_name)
				?.immutableCache
			? this.immutableCacheControl
			: undefined;
	}

	// ---------------------------------------------------------------------------
	// Adding media
	// ---------------------------------------------------------------------------

	add(owner: MediaOwner, file: MediaFile): AttachMediaBuilder {
		return new AttachMediaBuilder(this, owner, file);
	}

	addFromUrl(owner: MediaOwner, url: string): AttachMediaFromUrlBuilder {
		return new AttachMediaFromUrlBuilder(this, owner, url);
	}

	copy(owner: MediaOwner, mediaId: number): CopyMediaBuilder {
		return new CopyMediaBuilder(this, owner, mediaId);
	}

	/** Store `file` for `owner` and generate its registered conversions. */
	async addMedia(
		owner: MediaOwner,
		file: MediaFile,
		options: AddMediaOptions = {},
	): Promise<Media> {
		const ownerReference = toOwnerReference(owner);
		const modelType = ownerReference.model_type;
		const collection = options.collection ?? this.defaultCollection;
		const definition = this.getCollection(modelType, collection);
		const disk =
			options.disk ?? definition?.disk ?? this.storage.defaultDiskName;
		const visibility = definition?.visibility ?? "public";

		try {
			const sanitizedFileName = sanitizeFileName(
				options.fileName ?? file.originalname,
			);
			const fileName = definition?.immutableCache
				? withContentHash(sanitizedFileName, file.buffer)
				: sanitizedFileName;

			const media = await this.store.create({
				...ownerReference,
				collection_name: collection,
				name: path.parse(sanitizedFileName).name,
				file_name: fileName,
				mime_type: file.mimetype,
				disk,
				conversions_disk: disk,
				size: file.size,
				manipulations: JSON.stringify({}),
				custom_properties: JSON.stringify(options.customProperties ?? {}),
				generated_conversions: JSON.stringify({}),
				responsive_images: JSON.stringify({}),
				order_column: options.order ?? 0,
				visibility,
			});

			const storage = this.storage.disk(disk);
			const relativePath = this.getPath(media);

			try {
				await storage.makeDirectory(path.dirname(relativePath));
				const stored = await storage.put(relativePath, file.buffer, {
					contentType: file.mimetype,
					visibility,
					cacheControl: this.getCacheControl(media),
				});
				if (!stored) {
					throw new Error(`Disk [${disk}] did not store ${relativePath}`);
				}
			} catch (error) {
				// Do not leave a row pointing at a file that was never written
				await this.store.destroy(media.id).catch(() => undefined);
				throw error;
			}

			// Generate variants inline so caches invalidated right after the upload
			// already see them; failures are recorded for a later retry.
			await this.generateConversions(media, file.buffer);

			return media;
		} catch (error) {
			this.logger.error(
				`Failed to add media for [${modelType}] [${owner.id}]`,
				error,
			);

			throw error;
		}
	}

	/**
	 * Download `url` and store it for `owner`. Only pass URLs you trust: the
	 * library fetches whatever it is given.
	 */
	async addMediaFromUrl(
		owner: MediaOwner,
		url: string,
		options: AddMediaOptions = {},
	): Promise<Media> {
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(
				`Failed to download media from URL: ${response.status} ${response.statusText}`,
			);
		}

		const buffer = Buffer.from(await response.arrayBuffer());

		return this.addMedia(
			owner,
			{
				fieldname: "file",
				originalname: options.fileName ?? fileNameFromUrl(url),
				encoding: "7bit",
				mimetype:
					response.headers.get("content-type") || "application/octet-stream",
				size: buffer.length,
				buffer,
			},
			{ ...options, fileName: undefined },
		);
	}

	/**
	 * Duplicate an existing media item (file and conversions) onto `owner`.
	 * With `collectionName`, the copy moves to that collection and its file name
	 * is prefixed with `{collection}-{sourceId}-`.
	 */
	async copyMedia(
		owner: MediaOwner,
		mediaId: number,
		collectionName?: string,
	): Promise<Media> {
		const source = await this.store.findById(mediaId);
		if (!source) {
			throw new Error("Media not found");
		}

		const duplicated = await this.store.create({
			...toOwnerReference(owner),
			collection_name: collectionName || source.collection_name,
			name: source.name,
			file_name: collectionName
				? `${collectionName}-${mediaId}-${source.file_name}`
				: source.file_name,
			mime_type: source.mime_type,
			disk: source.disk,
			conversions_disk: source.conversions_disk,
			size: source.size,
			manipulations: source.manipulations,
			custom_properties: source.custom_properties,
			generated_conversions: source.generated_conversions,
			responsive_images: source.responsive_images,
			order_column: source.order_column,
			visibility: source.visibility,
		});

		const storage = this.storage.disk(source.disk);
		const sourcePaths = Array.from(
			new Set(
				[
					this.getDirectory(source),
					...(this.pathGenerator.getFallbackDirectories?.(source) ?? []),
				].map((directory) => path.join(directory, source.file_name)),
			),
		);
		const targetPath = this.getPath(duplicated);

		let copied = false;
		for (const sourcePath of sourcePaths) {
			copied = await storage.copy(sourcePath, targetPath);
			if (copied) {
				break;
			}
		}

		if (!copied) {
			await storage.delete(targetPath);
			await this.store.destroy(duplicated.id);
			this.logger.warn(
				`Failed to duplicate media file [${mediaId}] from paths: ${sourcePaths.join(", ")}`,
			);
			throw new Error(`Failed to duplicate media file [${mediaId}]`);
		}

		try {
			const conversionStorage = this.storage.disk(
				source.conversions_disk || source.disk,
			);

			for (const conversionName of Object.keys(
				parseJsonColumn(source.generated_conversions),
			)) {
				await conversionStorage.copy(
					this.getConversionPath(source, conversionName),
					this.getConversionPath(duplicated, conversionName),
				);
			}
		} catch (error) {
			this.logger.error(
				"Failed to copy media conversions",
				(error as Error).message,
			);
		}

		return duplicated;
	}

	// ---------------------------------------------------------------------------
	// Conversions
	// ---------------------------------------------------------------------------

	/** Whether this media has registered conversions to generate. */
	hasConversions(media: Media): boolean {
		return (
			CONVERTIBLE_IMAGE_MIME_TYPES.includes(media.mime_type ?? "") &&
			media.visibility !== "private" &&
			this.getConversions(media.model_type, media.collection_name).length > 0
		);
	}

	getConversionAttempts(media: Pick<Media, "custom_properties">): number {
		return (
			Number(parseJsonColumn(media.custom_properties).conversion_attempts) || 0
		);
	}

	/** Whether failed conversions should still be retried. */
	shouldRetryConversions(media: Pick<Media, "custom_properties">): boolean {
		return this.getConversionAttempts(media) < this.conversionMaxAttempts;
	}

	/**
	 * Generate registered conversions without throwing. A failure is counted in
	 * `custom_properties.conversion_attempts`.
	 */
	async generateConversions(
		media: Media,
		sourceBuffer?: Buffer,
	): Promise<boolean> {
		if (!this.hasConversions(media)) return false;

		try {
			await this.performConversions(media, sourceBuffer);
			return true;
		} catch (error) {
			this.logger.error(
				`Failed to perform conversions for media [${media.id}]`,
				error,
			);

			const customProperties = parseJsonColumn(media.custom_properties);
			try {
				await this.store.update(media.id, {
					custom_properties: JSON.stringify({
						...customProperties,
						conversion_attempts: this.getConversionAttempts(media) + 1,
					}),
				});
			} catch (updateError) {
				this.logger.error(
					`Failed to record conversion attempt for media [${media.id}]`,
					updateError,
				);
			}

			return false;
		}
	}

	/** Render and store every registered conversion. Throws on failure. */
	async performConversions(
		media: Media,
		sourceBuffer?: Buffer,
	): Promise<Record<string, MediaGeneratedConversion>> {
		const conversions = this.getConversions(
			media.model_type,
			media.collection_name,
		);
		const generatedConversions: Record<string, MediaGeneratedConversion> = {};
		if (conversions.length === 0) return generatedConversions;

		const conversionDisk = this.storage.disk(
			media.conversions_disk || media.disk,
		);
		const source =
			sourceBuffer ??
			(await this.storage.disk(media.disk).get(this.getPath(media)));
		const relativeDirectory = this.getDirectory(media);
		const cacheControl = this.getCacheControl(media);

		await conversionDisk.makeDirectory(
			path.join(relativeDirectory, "conversions"),
		);

		for (const conversion of conversions) {
			const fileName = getConversionFileName({
				conversionName: conversion.name,
				fileName: media.file_name,
				format: conversion.format,
			});
			const output = await renderConversion(source, conversion);

			await conversionDisk.put(
				getConversionRelativePath(relativeDirectory, fileName),
				output.data,
				{
					contentType:
						CONVERSION_CONTENT_TYPES[output.format] ?? media.mime_type,
					visibility: media.visibility,
					cacheControl,
				},
			);

			generatedConversions[conversion.name] = {
				file_name: fileName,
				width: output.width,
				height: output.height,
				format: output.format,
				size: output.size,
			};
		}

		const serializedConversions = JSON.stringify(generatedConversions);
		await this.store.update(media.id, {
			generated_conversions: serializedConversions,
		});
		media.generated_conversions = serializedConversions;

		return generatedConversions;
	}

	/**
	 * Public, convertible media in collections with conversions whose
	 * conversions were never generated. Use with `generateConversions` and
	 * `shouldRetryConversions` to backfill.
	 */
	findPendingConversions({
		afterId = 0,
		limit = 50,
	}: {
		afterId?: number;
		limit?: number;
	} = {}): Promise<Media[]> {
		const targets = [...this.collections.entries()].flatMap(
			([modelType, collections]) => {
				const names = [...collections.entries()]
					.filter(([, definition]) => (definition.conversions?.length ?? 0) > 0)
					.map(([name]) => name);

				return names.length > 0 ? [{ modelType, collections: names }] : [];
			},
		);

		return this.store.findPendingConversions({
			afterId,
			limit,
			targets,
			mimeTypes: CONVERTIBLE_IMAGE_MIME_TYPES,
		});
	}

	// ---------------------------------------------------------------------------
	// Queries
	// ---------------------------------------------------------------------------

	/** Media of `owner`, optionally limited to one collection, by `order_column`. */
	getMedia(owner: MediaOwner, collection?: string): Promise<Media[]> {
		return this.store.findForOwner(toOwnerReference(owner), collection);
	}

	getFirstMedia(
		owner: MediaOwner,
		collection: string = this.defaultCollection,
	): Promise<Media | null> {
		return this.store.findFirstForOwner(toOwnerReference(owner), collection);
	}

	findById(mediaId: number): Promise<Media | null> {
		return this.store.findById(mediaId);
	}

	/** First media whose owner key (`model_uuid`) is `uuid`. */
	findByOwnerUuid(uuid: string): Promise<Media | null> {
		return this.store.findByOwnerUuid(uuid);
	}

	// ---------------------------------------------------------------------------
	// Mutations
	// ---------------------------------------------------------------------------

	/**
	 * Delete the file, its conversions and the row. Resolves `false` when the
	 * media does not exist or the original file could not be removed.
	 */
	async deleteMedia(mediaOrId: number | Media): Promise<boolean> {
		try {
			const media =
				typeof mediaOrId === "number"
					? await this.store.findById(mediaOrId)
					: mediaOrId;

			if (!media) return false;

			const storage = this.storage.disk(media.disk);
			await storage.delete(this.getPath(media));

			try {
				const conversionNames = Object.keys(
					parseJsonColumn(media.generated_conversions),
				);
				const conversionStorage =
					conversionNames.length > 0
						? this.storage.disk(media.conversions_disk || media.disk)
						: storage;

				for (const conversionName of conversionNames) {
					await conversionStorage.delete(
						this.getConversionPath(media, conversionName),
					);
				}
			} catch (error) {
				this.logger.error(
					`Failed to delete media conversions for media [${media.id}]`,
					error,
				);
			}

			await this.store.destroy(media.id);

			return true;
		} catch (error) {
			const mediaId = typeof mediaOrId === "number" ? mediaOrId : mediaOrId.id;
			this.logger.error(`Failed to delete media [${mediaId}]`, error);
			return false;
		}
	}

	/** Delete every media item of `owner`, optionally in one collection. */
	async clearMediaCollection(
		owner: MediaOwner,
		collection?: string,
	): Promise<boolean> {
		try {
			for (const media of await this.getMedia(owner, collection)) {
				await this.deleteMedia(media);
			}

			return true;
		} catch (error) {
			this.logger.error(
				`Failed to clear media collection for [${owner.id}]`,
				error,
			);
			return false;
		}
	}

	/** Shallow-merge `customProperties` into the stored custom properties. */
	async updateCustomProperties(
		mediaId: number,
		customProperties: Record<string, unknown>,
	): Promise<boolean> {
		try {
			const media = await this.store.findById(mediaId);
			if (!media) return false;

			await this.store.update(mediaId, {
				custom_properties: JSON.stringify({
					...parseJsonColumn(media.custom_properties),
					...customProperties,
				}),
			});

			return true;
		} catch (error) {
			this.logger.error(
				`Failed to update custom properties for media ${mediaId}`,
				error,
			);
			return false;
		}
	}

	/** Set `order_column` to 1..n following the order of `mediaIds`. */
	async setOrder(mediaIds: number[]): Promise<boolean> {
		try {
			for (const [index, mediaId] of mediaIds.entries()) {
				await this.store.update(mediaId, { order_column: index + 1 });
			}

			return true;
		} catch (error) {
			this.logger.error("Failed to set new media order", error);
			return false;
		}
	}
}

export const createMediaLibrary = (options: MediaLibraryOptions) =>
	new MediaLibrary(options);

export type { MediaCreationAttributes };
