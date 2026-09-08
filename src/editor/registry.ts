export { componentRegistry } from "./registryCore";
export { registerDeviceComponents, registerDeviceTemplateComponents } from "./registerDeviceComponents";

import { componentRegistry } from "./registryCore";
import { registerProjectEntities } from "./registerProjectEntities";
import { registerDefaultAnalyzers } from "./analyzer";
import logger from "../utils/logger";

export function registerBuiltinComponents(): void {
  logger.info("Registry", "registerProjectEntities START", {
    beforeCount: componentRegistry.getAll().length,
  });

  registerProjectEntities();
  // project-sight: 注册内置分析器插件（§4 分析器插件体系）
  registerDefaultAnalyzers();
  // project-sight: 不再注册 biosphere 设备组件
  // 保留为参考代码：registerDeviceTemplateComponents();

  logger.info("Registry", "registerProjectEntities DONE", {
    finalCount: componentRegistry.getAll().length,
    allTypes: componentRegistry.getAll().map((d) => d.type),
  });
}
