/** @type {import("prettier").Config} */
const config = {
  singleQuote: false,
  semi: true,
  useTabs: false,
  tabWidth: 2,
  printWidth: 80,
  bracketSpacing: true,
  htmlWhitespaceSensitivity: "strict",
  arrowParens: "always",
  tailwindFunctions: ["clsx", "cn", "tv", "tva"],
  plugins: [
    require.resolve("@trivago/prettier-plugin-sort-imports"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
  importOrder: ["<THIRD_PARTY_MODULES>", "^@baro/.*$", "^@/.*$", "^[./]"],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
};

module.exports = config;
