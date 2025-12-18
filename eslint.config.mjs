import vue from 'eslint-plugin-vue';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';

export default [
    {
        files: ['**/*.{js,mjs,cjs,ts,tsx,vue}'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: typescriptParser,
                ecmaVersion: 2020,
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true
                }
            }
        },
        plugins: {
            vue,
            '@typescript-eslint': typescriptEslint
        },
        rules: {
            'no-unused-vars': 'off',
            'no-useless-escape': 'off',
            'vue/multi-word-component-names': 'off',
            // Check for unused imports
            '@typescript-eslint/no-unused-vars': ['error', {
                'vars': 'all',
                'args': 'after-used',
                'ignoreRestSiblings': true,
                'varsIgnorePattern': '^_',
                'argsIgnorePattern': '^_'
            }]
        }
    },
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'extension/**',
            'build/**',
            '*.config.js',
            '*.config.mjs',
            '*.config.ts',
            '*.config.mts'
        ]
    }
];