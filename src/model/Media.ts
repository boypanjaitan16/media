import path from "node:path";
import {
	DataTypes,
	Model,
	type ModelStatic,
	type NonAttribute,
	type Sequelize,
} from "sequelize";
import {
	getConversionRelativePath,
	type PathGenerator,
	parseJsonColumn,
	resolveConversionFileName,
} from "../paths/mediaPath";
import type { StorageManager } from "../storage/StorageManager";
import type {
	MediaGeneratedConversion,
	MediaUrls,
	MediaVariant,
	MediaVisibility,
} from "../types";

/** Runtime services a `Media` instance needs to resolve paths and URLs. */
export interface MediaModelContext {
	storage: StorageManager;
	pathGenerator: PathGenerator;
}

// A type alias (not an interface) so it stays assignable to Sequelize's index-signature creation types
export type MediaCreationAttributes = {
	model_type?: string;
	model_id?: number | null;
	model_uuid?: string | null;
	collection_name: string;
	name: string;
	file_name: string;
	mime_type?: string;
	disk: string;
	conversions_disk?: string | null;
	size: number;
	manipulations: string;
	custom_properties: string;
	generated_conversions: string;
	responsive_images: string;
	order_column?: number | null;
	visibility: MediaVisibility;
	created_at?: Date;
	updated_at?: Date | null;
};

export class Media extends Model {
	declare id: number;
	declare model_type?: string;
	declare model_id?: number | null;
	declare model_uuid?: string | null;
	declare collection_name: string;
	declare name: string;
	declare file_name: string;
	declare mime_type?: string;
	declare disk: string;
	declare conversions_disk?: string | null;
	declare size: number;
	declare manipulations: string;
	declare custom_properties: string;
	declare generated_conversions: string;
	declare responsive_images: string;
	declare order_column?: number | null;
	declare visibility: MediaVisibility;
	declare created_at?: Date;
	declare updated_at?: Date | null;

	declare url: NonAttribute<string>;
	declare relative_directory: NonAttribute<string>;
	declare relative_path: NonAttribute<string>;

	/** Set by `initMediaModel`. */
	static mediaContext?: MediaModelContext;

	protected getMediaContext(): MediaModelContext {
		const context = (this.constructor as typeof Media).mediaContext;
		if (!context) {
			throw new Error(
				"Media model is not initialized. Create the media library with createMediaLibrary() first.",
			);
		}

		return context;
	}

	/** Directory of the original file inside its disk. */
	getRelativeDirectory(): string {
		return this.getMediaContext().pathGenerator.getDirectory({
			disk: this.getDataValue("disk"),
			model_id: this.getDataValue("model_id"),
			model_type: this.getDataValue("model_type"),
			model_uuid: this.getDataValue("model_uuid"),
		});
	}

	/** Path of the original file inside its disk, or `""` without a file name. */
	getRelativePath(): string {
		const fileName = this.getDataValue("file_name");
		if (typeof fileName !== "string" || fileName.length === 0) {
			return "";
		}

		return path.join(this.getRelativeDirectory(), fileName);
	}

	/** Path of a generated conversion inside the conversions disk. */
	getConversionRelativePath(conversionName: string): string {
		const fileName = this.getDataValue("file_name");
		if (typeof fileName !== "string" || fileName.length === 0) {
			return "";
		}

		const generatedConversions = parseJsonColumn(
			this.getDataValue("generated_conversions"),
		);

		return getConversionRelativePath(
			this.getRelativeDirectory(),
			resolveConversionFileName(
				fileName,
				conversionName,
				generatedConversions[conversionName],
			),
		);
	}

	/** Public URL (or relative path) of the original or one of its conversions. */
	getUrl(options: { conversion?: string; pathOnly?: boolean } = {}): string {
		const { conversion, pathOnly = false } = options;

		const relativePath = conversion
			? this.getConversionRelativePath(conversion)
			: this.getRelativePath();

		if (pathOnly || !relativePath) {
			return relativePath || "";
		}

		const disk: string | undefined = conversion
			? this.getDataValue("conversions_disk") || this.getDataValue("disk")
			: this.getDataValue("disk");

		return this.getMediaContext().storage.disk(disk).url(relativePath);
	}

	/** URLs of the original and every generated conversion. */
	getUrls(pathOnly = false): MediaUrls {
		const conversions: Record<string, string> = {};
		const generatedConversions = parseJsonColumn(
			this.getDataValue("generated_conversions"),
		);

		for (const conversionName of Object.keys(generatedConversions)) {
			conversions[conversionName] = this.getUrl({
				conversion: conversionName,
				pathOnly,
			});
		}

		return { original: this.getUrl({ pathOnly }), conversions };
	}

	/**
	 * Public responsive variants (resized conversions), smallest first.
	 * Private media has no variants because each would need a signed URL.
	 */
	getVariants(): MediaVariant[] {
		if (this.getDataValue("visibility") === "private") {
			return [];
		}

		const generatedConversions = parseJsonColumn(
			this.getDataValue("generated_conversions"),
		);

		return Object.entries(generatedConversions)
			.flatMap(([name, entry]) => {
				const conversion = entry as Partial<MediaGeneratedConversion> | null;
				if (
					!conversion ||
					typeof conversion !== "object" ||
					typeof conversion.width !== "number" ||
					typeof conversion.height !== "number"
				) {
					return [];
				}

				const url = this.getUrl({ conversion: name });
				if (!url) {
					return [];
				}

				return [
					{
						name,
						url,
						width: conversion.width,
						height: conversion.height,
						format: conversion.format ?? "",
					},
				];
			})
			.sort((a, b) => a.width - b.width);
	}

	/** Public URL, or a temporary signed URL for private media. */
	async resolveUrl(expiresInSeconds = 3600): Promise<string> {
		const relativePath = this.getRelativePath();
		if (!relativePath) {
			return "";
		}

		const disk = this.getMediaContext().storage.disk(this.disk);
		if (this.visibility === "private") {
			return disk.temporaryUrl(relativePath, expiresInSeconds);
		}

		return disk.url(relativePath);
	}
}

export interface InitMediaModelOptions {
	sequelize: Sequelize;
	context: MediaModelContext;
	tableName?: string;
	modelName?: string;
}

/** Initialize `model` (the `Media` class or a subclass) against a Sequelize instance. */
export const initMediaModel = <M extends typeof Media>(
	model: M,
	{
		sequelize,
		context,
		tableName = "media",
		modelName = "Media",
	}: InitMediaModelOptions,
): M => {
	model.mediaContext = context;

	(model as ModelStatic<Media> & typeof Media).init(
		{
			id: {
				type: DataTypes.BIGINT,
				autoIncrement: true,
				primaryKey: true,
			},
			model_type: { type: DataTypes.STRING },
			model_id: { type: DataTypes.BIGINT },
			model_uuid: { type: DataTypes.UUID },
			collection_name: { type: DataTypes.STRING },
			name: { type: DataTypes.STRING },
			file_name: { type: DataTypes.STRING },
			mime_type: { type: DataTypes.STRING },
			disk: { type: DataTypes.STRING },
			conversions_disk: { type: DataTypes.STRING },
			size: { type: DataTypes.INTEGER },
			manipulations: { type: DataTypes.STRING },
			custom_properties: { type: DataTypes.STRING },
			generated_conversions: { type: DataTypes.STRING },
			responsive_images: { type: DataTypes.STRING },
			order_column: { type: DataTypes.INTEGER },
			visibility: {
				type: DataTypes.STRING(10),
				allowNull: false,
				defaultValue: "public",
			},
			created_at: {
				type: DataTypes.DATE,
				allowNull: false,
				defaultValue: DataTypes.NOW,
			},
			updated_at: {
				type: DataTypes.DATE,
				allowNull: true,
			},
			url: {
				type: DataTypes.VIRTUAL,
				get(this: Media) {
					const relativePath = this.getRelativePath();
					if (!relativePath) {
						return "";
					}

					return this.getMediaContext()
						.storage.disk(this.getDataValue("disk"))
						.url(relativePath);
				},
			},
			relative_directory: {
				type: DataTypes.VIRTUAL,
				get(this: Media) {
					return this.getRelativeDirectory();
				},
			},
			relative_path: {
				type: DataTypes.VIRTUAL,
				get(this: Media) {
					return this.getRelativePath();
				},
			},
		},
		{
			sequelize,
			timestamps: true,
			modelName,
			tableName,
			createdAt: "created_at",
			updatedAt: "updated_at",
			indexes: [
				{ unique: false, fields: ["model_type", "model_id"] },
				{ unique: false, fields: ["model_type", "model_uuid"] },
				{
					unique: false,
					fields: ["model_type", "model_uuid", "collection_name"],
				},
				{
					unique: false,
					fields: ["model_type", "model_id", "collection_name"],
				},
			],
		},
	);

	return model;
};
