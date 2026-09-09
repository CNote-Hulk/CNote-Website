// Console Modding page: renders the "Find Your Model" hardware directory
// via the shared component in ../modules/model-directory.js (also used by
// console-care.js) — same MODELS data, links into console-model.html's
// "Modding Guide" section instead of the disassembly tutorial.

import { initModelDirectory } from '../modules/model-directory.js?v=20260909b';

initModelDirectory({ fromParam: 'modding' });
