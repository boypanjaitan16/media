import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		include: ["__test__/**/*.test.ts"],
		testTimeout: 60000,
	},
});
