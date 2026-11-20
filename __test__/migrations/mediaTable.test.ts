import assert from "node:assert/strict";
import type { QueryInterface } from "sequelize";
import { test } from "vitest";
import { createMediaTable, dropMediaTable } from "../../src";

const createFakeQueryInterface = () => {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	const record =
		(method: string) =>
		async (...args: unknown[]) => {
			calls.push({ method, args });
		};

	return {
		calls,
		queryInterface: {
			createTable: record("createTable"),
			addIndex: record("addIndex"),
			dropTable: record("dropTable"),
		} as unknown as QueryInterface,
	};
};

test("createMediaTable creates the table with every column the model uses", async () => {
	const { calls, queryInterface } = createFakeQueryInterface();

	await createMediaTable(queryInterface);

	const [table, columns] = calls[0]?.args as [string, Record<string, unknown>];
	assert.equal(calls[0]?.method, "createTable");
	assert.equal(table, "media");
	assert.deepEqual(Object.keys(columns), [
		"id",
		"model_type",
		"model_id",
		"model_uuid",
		"collection_name",
		"name",
		"file_name",
		"mime_type",
		"disk",
		"conversions_disk",
		"size",
		"manipulations",
		"custom_properties",
		"generated_conversions",
		"responsive_images",
		"order_column",
		"visibility",
		"created_at",
		"updated_at",
	]);
	assert.deepEqual(
		{
			allowNull: (columns.visibility as { allowNull: boolean }).allowNull,
			defaultValue: (columns.visibility as { defaultValue: string })
				.defaultValue,
		},
		{ allowNull: false, defaultValue: "public" },
	);
});

test("createMediaTable adds the owner lookup indexes for a custom table name", async () => {
	const { calls, queryInterface } = createFakeQueryInterface();

	await createMediaTable(queryInterface, { tableName: "system_media" });

	assert.equal(calls[0]?.args[0], "system_media");
	assert.deepEqual(
		calls
			.filter((call) => call.method === "addIndex")
			.map((call) => [call.args[1], (call.args[2] as { name: string }).name]),
		[
			[["model_type", "model_id"], "system_media_model_type_model_id_index"],
			[
				["model_type", "model_uuid"],
				"system_media_model_type_model_uuid_index",
			],
			[
				["model_type", "model_id", "collection_name"],
				"system_media_model_type_model_id_collection_name_index",
			],
			[
				["model_type", "model_uuid", "collection_name"],
				"system_media_model_type_model_uuid_collection_name_index",
			],
		],
	);
});

test("dropMediaTable drops the table", async () => {
	const { calls, queryInterface } = createFakeQueryInterface();

	await dropMediaTable(queryInterface, { tableName: "system_media" });

	assert.deepEqual(calls, [{ method: "dropTable", args: ["system_media"] }]);
});
