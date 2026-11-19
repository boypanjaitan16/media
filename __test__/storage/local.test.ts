import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { LocalStorageAdapter, localDisk } from "../../src/storage/local";

test("LocalStorageAdapter requires a configured disk root", () => {
	assert.throws(
		() =>
			new LocalStorageAdapter({
				root: " ",
				url: "https://storage.example.test",
			}),
		/Local storage disk config requires a root path/,
	);
});

test("LocalStorageAdapter reads and writes under the disk root", async () => {
	const rootDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), "local-storage-adapter-"),
	);
	const adapter = localDisk({
		root: rootDirectory,
		url: "https://storage.example.test",
	});

	try {
		assert.equal(await adapter.put("local/product/12/file.txt", "hello"), true);
		assert.equal(
			await fs.readFile(
				path.join(rootDirectory, "local", "product", "12", "file.txt"),
				"utf8",
			),
			"hello",
		);

		assert.equal(
			await adapter.copy("local/product/12/file.txt", "copy/file.txt"),
			true,
		);
		assert.equal((await adapter.get("copy/file.txt")).toString(), "hello");
		assert.equal(await adapter.copy("missing.txt", "copy/missing.txt"), false);

		assert.equal(await adapter.delete("copy/file.txt"), true);
		assert.equal(await adapter.exists("copy/file.txt"), false);
	} finally {
		await fs.rm(rootDirectory, { recursive: true, force: true });
	}
});

test("localDisk builds URLs from the configured base URL", () => {
	const adapter = localDisk({
		root: "./storage",
		url: "https://storage.example.test/",
	});

	assert.equal(
		adapter.url(path.join("local", "product", "12", "file.jpg")),
		"https://storage.example.test/local/product/12/file.jpg",
	);
	assert.equal(
		adapter.url("storage/media/a.jpg"),
		"https://storage.example.test/a.jpg",
	);
});
