// Jest configuration. Uses ts-jest so the TypeScript sources under `src/` can
// be tested directly without a separate compile step. Only `*.test.ts` files
// are treated as tests, so they never get bundled into the plugin build.
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: ['**/*.test.ts'],
};
