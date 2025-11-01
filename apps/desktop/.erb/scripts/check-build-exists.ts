// Check if the renderer and main bundles are built
import chalk from "chalk";
import fs from "fs";
import { TextDecoder, TextEncoder } from "node:util";
import path from "path";
import webpackPathsRaw from "../configs/webpack.paths.js";

type RequiredWebpackPaths = {
  distMainPath: string;
  distRendererPath: string;
};

const webpackPaths = webpackPathsRaw as RequiredWebpackPaths;

const mainPath = path.join(webpackPaths.distMainPath, "main.js");
const rendererPath = path.join(webpackPaths.distRendererPath, "renderer.js");

if (!fs.existsSync(mainPath)) {
  throw new Error(
    chalk.whiteBright.bgRed.bold(
      'The main process is not built yet. Build it by running "npm run build:main"',
    ),
  );
}

if (!fs.existsSync(rendererPath)) {
  throw new Error(
    chalk.whiteBright.bgRed.bold(
      'The renderer process is not built yet. Build it by running "npm run build:renderer"',
    ),
  );
}

// JSDOM does not implement TextEncoder and TextDecoder
if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;
}
