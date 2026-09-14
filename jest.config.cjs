/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests', '<rootDir>/src', '<rootDir>/server'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    // 测试侧使用同一语言包的兼容入口，浏览器仍使用标准模块入口。
    '^element-plus/es/locale/lang/zh-cn$': '<rootDir>/node_modules/element-plus/lib/locale/lang/zh-cn.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@server/(.*)$': '<rootDir>/server/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.vue$': '@vue/vue3-jest',
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'preserve',
          esModuleInterop: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,vue}',
    'server/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!src/auto-imports.d.ts',
    '!src/components.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 75,
      branches: 70,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'json', 'html', 'lcov'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'vue'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
}
