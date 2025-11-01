/**
 * Base webpack config used across other specific configs
 */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/no-unresolved */
import path from "path";
import TsconfigPathsPlugins from "tsconfig-paths-webpack-plugin";
import webpack from "webpack";
import webpackPaths from "./webpack.paths";

// eslint-disable-next-line global-require
const externals = require("../../release/app/package.json").dependencies || {};

const workspacePackagesPath = path.resolve(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  webpackPaths.rootPath,
  "..",
  "..",
  "packages",
);

const configuration: webpack.Configuration = {
  externals: [...Object.keys(externals as Record<string, string>)],

  stats: "errors-only",

  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        exclude: (modulePath: string) => {
          if (!modulePath) {
            return false;
          }

          const isNodeModule = modulePath.includes(`node_modules${path.sep}`);
          const isBaroWorkspaceModule = modulePath.includes(
            `${path.sep}@baro${path.sep}`,
          );

          return isNodeModule && !isBaroWorkspaceModule;
        },
        use: {
          loader: "ts-loader",
          options: {
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            allowTsInNodeModules: true,
            compilerOptions: {
              module: "esnext",
              moduleResolution: "bundler",
            },
          },
        },
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: { type: "commonjs2" },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: [".js", ".jsx", ".json", ".ts", ".tsx", ".mts", ".cts"],
    modules: [webpackPaths.srcPath, workspacePackagesPath, "node_modules"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".cjs": [".cts", ".cjs"],
      ".mjs": [".mts", ".mjs"],
    },
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
  },

  plugins: [new webpack.EnvironmentPlugin({ NODE_ENV: "production" })],
};

export default configuration;
