/* eslint-disable */
/**
 * Base webpack config used across other specific configs
 */

import path from "path";
import webpack from "webpack";
import TsconfigPathsPlugins from "tsconfig-paths-webpack-plugin";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import webpackPaths from "./webpack.paths";

dotenvExpand.expand(
  dotenv.config({ path: path.join(webpackPaths.rootPath, ".env") }),
);

export const SHARED_ENV_VARS = {
  POSELY_DEBUG_HUD: "",
  POSELY_DEBUG_CAMERA_PREVIEW: "",
  POSELY_DEBUG_HEAD_POSE: "",
  POSELY_DEBUG_ALLOW_UNRELIABLE_SIGNALS: "",
  POSELY_DEBUG_GUARDRAILS_VERBOSE: "",
  POSELY_CALIBRATION_DEBUG: "",
  POSELY_ENABLE_EXPERIMENTAL_SCORING: "",
  POSELY_DETECTOR: "",
  POSELY_FACE_PRESENCE_MIN_AREA: "",
  POSELY_FACE_PRESENCE_MAX_AREA: "",
  POSELY_FACE_PRESENCE_STABILITY_FALLBACK: "",
  POSELY_FACE_PRESENCE_AREA_WEIGHT: "",
  POSELY_FACE_PRESENCE_STABILITY_WEIGHT: "",
  POSELY_FACE_PRESENCE_MULTIPLE_PENALTY: "",
  POSELY_GUARDRAIL_YAW_ENTER_DEG: "",
  POSELY_GUARDRAIL_YAW_EXIT_DEG: "",
  POSELY_GUARDRAIL_YAW_ENTER_SECONDS: "",
  POSELY_GUARDRAIL_YAW_EXIT_SECONDS: "",
  POSELY_GUARDRAIL_ROLL_ENTER_DEG: "",
  POSELY_GUARDRAIL_ROLL_EXIT_DEG: "",
  POSELY_GUARDRAIL_ROLL_ENTER_SECONDS: "",
  POSELY_GUARDRAIL_ROLL_EXIT_SECONDS: "",
  POSELY_GUARDRAIL_CONF_FACE_THRESHOLD: "",
  POSELY_GUARDRAIL_CONF_POSE_THRESHOLD: "",
  POSELY_GUARDRAIL_CONF_ENTER_SECONDS: "",
  POSELY_GUARDRAIL_CONF_EXIT_SECONDS: "",
  POSELY_GUARDRAIL_ILLUM_THRESHOLD: "",
  POSELY_GUARDRAIL_ILLUM_ENTER_SECONDS: "",
  POSELY_GUARDRAIL_ILLUM_EXIT_SECONDS: "",
  POSELY_RISK_PITCH_DEG: "",
  POSELY_RISK_EHD_NORM: "",
  POSELY_RISK_DPR_DELTA: "",
  POSELY_RISK_TRIGGER_SEC: "",
  POSELY_RISK_RECOVERY_SEC: "",
  POSELY_RISK_HYST_DELTA_PCT: "",
  POSELY_RISK_DEGENERATE_PITCH_DEG: "",
  POSELY_SCORE_NEUTRAL: "",
  POSELY_SCORE_ALPHA: "",
  POSELY_SCORE_W_PITCH: "",
  POSELY_SCORE_W_EHD: "",
  POSELY_SCORE_W_DPR: "",
};
import { dependencies as externals } from "../../release/app/package.json";

const workspacePackagesPath = path.resolve(
  webpackPaths.rootPath,
  "..",
  "..",
  "packages",
);

const configuration: webpack.Configuration = {
  externals: [...Object.keys(externals || {})],

  stats: "errors-only",

  module: {
    rules: [
      {
        test: /vision_wasm_internal\.js$/i,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
      {
        test: /vision_wasm_internal\.wasm$/i,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
      {
        test: /pose_landmarker_lite\.task$/i,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
      {
        test: /face_landmarker\.task$/i,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
      {
        resourceQuery: /url/,
        type: "asset/resource",
      },
      {
        test: /\.[cm]?[jt]sx?$/,
        resourceQuery: {
          not: [/url/],
        },
        exclude: (modulePath: string) => {
          if (!modulePath) {
            return false;
          }

          const isMediapipeRuntimeAsset = modulePath.includes(
            `${path.sep}src${path.sep}shared${path.sep}detection${path.sep}assets${path.sep}vision_wasm_internal.js`,
          );

          if (isMediapipeRuntimeAsset) {
            return true;
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

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: "production",
      ...SHARED_ENV_VARS,
    }),
  ],
};

export default configuration;
