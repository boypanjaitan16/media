import { DataTypes, type QueryInterface } from "sequelize";

export interface MediaTableOptions {
	/** Defaults to `"media"`; must match `tableName` in `createMediaLibrary`. */
	tableName?: string;
}

const MEDIA_TABLE_INDEXES = [
	["model_type", "model_id"],
	["model_type", "model_uuid"],
	["model_type", "model_id", "collection_name"],
	["model_type", "model_uuid", "collection_name"],
] as const;

const indexName = (tableName: string, fields: readonly string[]) =>
	`${tableName}_${fields.join("_")}_index`;

/**
 * Create the media table and its owner lookup indexes. Call it from a
 * migration:
 *
 * ```js
 * const { createMediaTable, dropMediaTable } = require("@boyboni/media");
 *
 * module.exports = {
 *   up: (queryInterface) => createMediaTable(queryInterface),
 *   down: (queryInterface) => dropMediaTable(queryInterface),
 * };
 * ```
 */
export const createMediaTable = async (
	queryInterface: QueryInterface,
	{ tableName = "media" }: MediaTableOptions = {},
): Promise<void> => {
	await queryInterface.createTable(tableName, {
		id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
		model_type: { type: DataTypes.STRING, allowNull: false },
		model_id: { type: DataTypes.BIGINT, allowNull: true },
		model_uuid: { type: DataTypes.UUID, allowNull: true },
		collection_name: { type: DataTypes.STRING, allowNull: false },
		name: { type: DataTypes.STRING, allowNull: false },
		file_name: { type: DataTypes.STRING, allowNull: false },
		mime_type: { type: DataTypes.STRING, allowNull: true },
		disk: { type: DataTypes.STRING, allowNull: false },
		conversions_disk: { type: DataTypes.STRING, allowNull: true },
		size: { type: DataTypes.INTEGER, allowNull: false },
		manipulations: { type: DataTypes.TEXT, allowNull: false },
		custom_properties: { type: DataTypes.TEXT, allowNull: false },
		generated_conversions: { type: DataTypes.TEXT, allowNull: false },
		responsive_images: { type: DataTypes.TEXT, allowNull: false },
		order_column: { type: DataTypes.INTEGER, allowNull: true },
		visibility: {
			type: DataTypes.STRING(10),
			allowNull: false,
			defaultValue: "public",
		},
		created_at: { type: DataTypes.DATE, allowNull: false },
		updated_at: { type: DataTypes.DATE, allowNull: true },
	});

	for (const fields of MEDIA_TABLE_INDEXES) {
		await queryInterface.addIndex(tableName, [...fields], {
			name: indexName(tableName, fields),
		});
	}
};

/** Drop the media table created by `createMediaTable` (indexes go with it). */
export const dropMediaTable = async (
	queryInterface: QueryInterface,
	{ tableName = "media" }: MediaTableOptions = {},
): Promise<void> => {
	await queryInterface.dropTable(tableName);
};
