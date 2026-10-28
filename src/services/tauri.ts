// ═══════════════════════════════════════════════════════
// services/tauri.ts — barrel 汇总：按域拆分后的统一出口。
// 各域实现见 ./core ./auth ./settings ./datasource ./analysis
// ./projectScan ./codeChange ./agent ./fileWatcher ./aiContext
// ./fs ./terminal ./writing ./asset ./corpus
// ═══════════════════════════════════════════════════════
export * from './core';
export * from './auth';
export * from './settings';
export * from './datasource';
export * from './analysis';
export * from './projectScan';
export * from './codeChange';
export * from './agent';
export * from './fileWatcher';
export * from './aiContext';
export * from './fs';
export * from './terminal';
export * from './writing';
export * from './asset';
export * from './corpus';
