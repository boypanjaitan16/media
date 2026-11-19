import assert from "node:assert/strict";
import { test } from "vitest";
import { StorageManager } from "../../src";
import { createFakeDisk } from "../helpers";

test("StorageManager resolves named and default disks", () => {
	const local = createFakeDisk("local");
	const gcs = createFakeDisk("gcs");
	const manager = new StorageManager({
		defaultDisk: "local",
		disks: { local, gcs },
	});

	assert.equal(manager.disk(), local);
	assert.equal(manager.disk(null), local);
	assert.equal(manager.disk("gcs"), gcs);
	assert.equal(manager.defaultDiskName, "local");
});

test("StorageManager creates factory disks lazily and once", () => {
	let created = 0;
	const manager = new StorageManager({
		defaultDisk: "local",
		disks: {
			local: createFakeDisk("local"),
			lazy: () => {
				created += 1;
				return createFakeDisk("lazy");
			},
		},
	});

	assert.equal(created, 0);
	const first = manager.disk("lazy");
	assert.equal(manager.disk("lazy"), first);
	assert.equal(created, 1);
});

test("StorageManager fails on unknown disks", () => {
	assert.throws(
		() => new StorageManager({ defaultDisk: "s3", disks: {} }),
		/Default disk \[s3\] is not defined/,
	);

	const manager = new StorageManager({
		defaultDisk: "local",
		disks: { local: createFakeDisk("local") },
	});
	assert.throws(() => manager.disk("gcs"), /Disk \[gcs\] is not defined/);
	assert.throws(
		() => manager.disk("toString"),
		/Disk \[toString\] is not defined/,
	);
});
