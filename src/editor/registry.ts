export { componentRegistry } from "./registryCore";

import { componentRegistry } from "./registryCore";
import { registerProjectEntities } from "./registerProjectEntities";
import { registerDefaultAnalyzers } from "./analyzer";
import logger from "../utils/logger";

export function registerBuiltinComponents(): void {
  logger.info("Registry", "registerProjectEntities START", {
    beforeCount: componentRegistry.getAll().length,
  });

  registerProjectEntities();
  // sight-folio: 注册内置分析器插件（§4 分析器插件体系）
  registerDefaultAnalyzers();

  logger.info("Registry", "registerProjectEntities DONE", {
    finalCount: componentRegistry.getAll().length,
    allTypes: componentRegistry.getAll().map((d) => d.type),
  });
}
