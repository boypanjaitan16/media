import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/storage/local.ts",
		"src/storage/gcs.ts",
		"src/storage/s3.ts",
	],
	format: ["cjs", "esm"],
	outDir: "dist",
	dts: true,
	clean: !process.argv.includes("--watch"),
	sourcemap: true,
	target: "node20",
	// Peer SDKs are loaded lazily at runtime and must never be bundled.
	external: [
		"sequelize",
		"sharp",
		"@google-cloud/storage",
		"@aws-sdk/client-s3",
		"@aws-sdk/s3-request-presigner",
	],
});
