// eslint.config.mjs
export default [
    {
        rules: {
            "no-unused-vars": "off",
            "no-useless-escape": "off",
            "vue/multi-word-component-names": "off",
            // Check for unused imports
            "@typescript-eslint/no-unused-vars": ["error", {
                "vars": "all",
                "args": "after-used",
                "ignoreRestSiblings": true,
                "varsIgnorePattern": "^_",
                "argsIgnorePattern": "^_"
            }]
        }
    }
];