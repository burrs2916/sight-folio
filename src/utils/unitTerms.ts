// 句子里的单位名词参数（⑰-1，2026-11-10）
//
// 判据住在 writingSchema（unitWordKey / unitShortKey），这里只做**翻译 + 插值参数**，
// 因为文案里要用三种形态：
//   {unit}=章节/篇目/诗作/场次（句中双字词）  {Unit}=英文首字母大写（New Chapter / Chapter title）
//   {unitShort}=章/篇/首/场（中文量词：「新建一**篇**」）—— 注意诗歌徽标是「诗」而量词是「首」，
//   所以走 unitClassifierKey，不复用 unitShortKey（⑰-1 测试抓出来的）
// 英文必须有 {Unit}/{unit} 两套：'New Chapter' 与 'Delete chapter' 大小写不同，
// 只给一套就会把小说侧的历史文案改掉（那是要逐字零回归的）。
import { t } from '../i18n';
import { unitClassifierKey, unitWordKey } from './writingSchema';

export function unitTermParams(genre: string): Record<string, string> {
  const w = t(unitWordKey(genre));
  return {
    unit: w,
    Unit: w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w,
    unitShort: t(unitClassifierKey(genre)),
  };
}
