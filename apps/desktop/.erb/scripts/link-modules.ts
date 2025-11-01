import fs from "fs";
import webpackPathsRaw from "../configs/webpack.paths.js";

type NodeModulesPaths = {
  srcNodeModulesPath: string;
  appNodeModulesPath: string;
  erbNodeModulesPath: string;
};

const { srcNodeModulesPath, appNodeModulesPath, erbNodeModulesPath } =
  webpackPathsRaw as NodeModulesPaths;

if (fs.existsSync(appNodeModulesPath)) {
  if (!fs.existsSync(srcNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, "junction");
  }
  if (!fs.existsSync(erbNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, erbNodeModulesPath, "junction");
  }
}
