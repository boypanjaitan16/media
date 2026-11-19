import { col, Op, type Order, type WhereOptions, where } from "sequelize";
import type { Media, MediaCreationAttributes } from "../model/Media";

export interface MediaOwnerReference {
	model_type: string;
	model_id: number | null;
	model_uuid: string | null;
}

export interface PendingConversionQuery {
	/** Only rows with `id` greater than this. */
	afterId: number;
	limit: number;
	/** Owner types and collections that have conversions registered. */
	targets: Array<{ modelType: string; collections: string[] }>;
	mimeTypes: string[];
}

/**
 * Persistence used by the library. The default implementation wraps the
 * Sequelize `Media` model; tests and other ORMs can supply their own.
 */
export interface MediaStore {
	create(attributes: MediaCreationAttributes): Promise<Media>;
	findById(id: number): Promise<Media | null>;
	findByOwnerUuid(uuid: string): Promise<Media | null>;
	findForOwner(
		owner: MediaOwnerReference,
		collection?: string,
	): Promise<Media[]>;
	findFirstForOwner(
		owner: MediaOwnerReference,
		collection: string,
	): Promise<Media | null>;
	findPendingConversions(query: PendingConversionQuery): Promise<Media[]>;
	update(
		id: number,
		attributes: Partial<MediaCreationAttributes>,
	): Promise<void>;
	destroy(id: number): Promise<void>;
}

const ownerWhere = (owner: MediaOwnerReference, collection?: string) => ({
	model_type: owner.model_type,
	model_id: owner.model_id,
	model_uuid: owner.model_uuid,
	...(collection ? { collection_name: collection } : {}),
});

const BY_ORDER_COLUMN: Order = [["order_column", "ASC"]];

export const createSequelizeMediaStore = (model: typeof Media): MediaStore => ({
	create: (attributes) => model.create(attributes as never),
	findById: (id) => model.findByPk(id),
	findByOwnerUuid: (uuid) => model.findOne({ where: { model_uuid: uuid } }),
	findForOwner: (owner, collection) =>
		model.findAll({
			where: ownerWhere(owner, collection),
			order: BY_ORDER_COLUMN,
		}),
	findFirstForOwner: (owner, collection) =>
		model.findOne({
			where: ownerWhere(owner, collection),
			order: BY_ORDER_COLUMN,
		}),
	findPendingConversions: ({ afterId, limit, targets, mimeTypes }) => {
		if (targets.length === 0) {
			return Promise.resolve([]);
		}

		const conditions: WhereOptions = {
			id: { [Op.gt]: afterId },
			[Op.or]: targets.map(({ modelType, collections }) => ({
				model_type: modelType,
				collection_name: { [Op.in]: collections },
			})),
			mime_type: { [Op.in]: mimeTypes },
			visibility: "public",
			[Op.and]: [
				{
					[Op.or]: [
						where(col("generated_conversions"), Op.is, null),
						{ generated_conversions: { [Op.in]: ["", "{}"] } },
					],
				},
			],
		};

		return model.findAll({
			where: conditions,
			order: [["id", "ASC"]],
			limit,
		});
	},
	update: async (id, attributes) => {
		await model.update(attributes, { where: { id } });
	},
	destroy: async (id) => {
		await model.destroy({ where: { id } });
	},
});
