const path = require("node:path");

const quote = (value) => JSON.stringify(value);

const lintWorkspace = (workspaceDir) => {
  const workspacePath = path.resolve(workspaceDir);

  return (files) => {
    if (!files.length) return [];

    const eslintTargets = files.filter(
      (file) => !file.endsWith(`${path.sep}vitest.config.ts`),
    );
    const prettierTargets = files;

    const relativeFiles = eslintTargets.map((file) =>
      quote(path.relative(workspacePath, file)),
    );
    const absoluteFiles = prettierTargets.map(quote).join(" ");

    const eslintCommands = [];

    if (relativeFiles.length) {
      const eslintFixCommand = [
        `pnpm --dir ${quote(workspaceDir)} exec eslint --fix`,
        ...relativeFiles,
      ].join(" ");

      const unusedLintCommand = [
        `pnpm --dir ${quote(workspaceDir)} exec eslint --quiet --report-unused-disable-directives`,
        `--rule ${quote("@typescript-eslint/no-floating-promises: 0")}`,
        `--rule ${quote("@typescript-eslint/no-unsafe-assignment: 0")}`,
        `--rule ${quote("@typescript-eslint/no-require-imports: 0")}`,
        `--rule ${quote("@typescript-eslint/no-unsafe-call: 0")}`,
        `--rule ${quote("@typescript-eslint/no-unsafe-member-access: 0")}`,
        `--rule ${quote("turbo/no-undeclared-env-vars: 0")}`,
        `--rule ${quote("@typescript-eslint/require-await: 0")}`,
        `--rule ${quote("@typescript-eslint/no-unsafe-return: 0")}`,
        `--rule ${quote("no-unused-vars: 2")}`,
        `--rule ${quote("@typescript-eslint/no-unused-vars: 2")}`,
        `--rule ${quote("import/prefer-default-export: 0")}`,
        `--rule ${quote("import/no-extraneous-dependencies: 0")}`,
        `--rule ${quote("import/no-unresolved: 0")}`,
        `--rule ${quote("no-console: 0")}`,
        `--rule ${quote("jsx-a11y/label-has-associated-control: 0")}`,
        `--rule ${quote("@typescript-eslint/no-unsafe-argument: 0")}`,
        `--rule ${quote("global-require: 0")}`,
        `--rule ${quote("no-use-before-define: 0")}`,
        `--rule ${quote("prettier/prettier: 0")}`,
        ...relativeFiles,
      ].join(" ");

      eslintCommands.push(eslintFixCommand, unusedLintCommand);
    }

    return [...eslintCommands, `pnpm exec prettier --write ${absoluteFiles}`];
  };
};

const formatOnly = (files) =>
  files.length
    ? [`pnpm exec prettier --write ${files.map(quote).join(" ")}`]
    : [];

const workspacePrefixes = ["apps/desktop"].map((prefix) => {
  const absolute = path.resolve(prefix);
  return absolute.endsWith(path.sep) ? absolute : `${absolute}${path.sep}`;
});

module.exports = {
  "apps/desktop/**/*.{ts,tsx,js,jsx}": lintWorkspace("apps/desktop"),
  "*.{ts,tsx,js,jsx}": (files) => {
    const remaining = files.filter(
      (file) => !workspacePrefixes.some((prefix) => file.startsWith(prefix)),
    );

    return remaining.length
      ? [`pnpm exec prettier --write ${remaining.map(quote).join(" ")}`]
      : [];
  },
  "*.{json,md,mdx,css,scss,yml,yaml}": formatOnly,
};
