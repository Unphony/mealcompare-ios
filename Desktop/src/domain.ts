export type Platform = 'meituan' | 'eleme';
export const platforms: Platform[] = ['meituan', 'eleme'];
export const homes = {meituan:'https://h5.waimai.meituan.com/waimai/mindex/home', eleme:'https://h5.ele.me/'};
export const searches = {meituan:'https://h5.waimai.meituan.com/waimai/mindex/search', eleme:'https://h5.ele.me/search/#/'};
export type JobKind = 'search' | 'inspect' | 'history';
export interface JobInput { requestID:string; platform:Platform; kind:JobKind; query:string; budgetCents:number }
export interface Job { id:string; input:JobInput; state:'running'|'completed'|'needs-user'|'interrupted'|'failed'; message:string; updatedAt:string; result?:unknown }
export interface Food { key:string; quantity:number }
export interface Quote {
  id:string; platform:Platform; storeKey:string; addressKey:string; batchKey:string;
  items:Food[]; totalCents:number; observedAt:string; etaText:string; checkoutVerified:boolean;
}
export function quantities(items:Food[]):Map<string,number> {
  const result = new Map<string,number>();
  for (const item of items) {
    if (!item.key.trim() || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw Error('餐品数量无效');
    const sum = (result.get(item.key) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(sum)) throw Error('餐品数量过大');
    result.set(item.key, sum);
  }
  if (!result.size) throw Error('购物篮为空');
  return result;
}
// Keys represent a verified product AND its full specification. Unknown bundles stay opaque.
// No automatic cross-platform mapping; storeKey must be platform-scoped unless manually verified.
export function dominates(b:Quote, a:Quote):boolean {
  if (b.storeKey !== a.storeKey || b.addressKey !== a.addressKey || b.batchKey !== a.batchKey || b.totalCents > a.totalCents) return false;
  const left = quantities(b.items), right = quantities(a.items);
  if (![...right].every(([key,n]) => (left.get(key) ?? 0) >= n)) return false;
  return b.totalCents < a.totalCents || [...left].some(([key,n]) => n > (right.get(key) ?? 0));
}
export function frontier(quotes:Quote[], budgetCents:number, required:Food[]):Quote[] {
  const needs = quantities(required);
  const candidates = quotes.filter(q => {
    try {
      const items = quantities(q.items);
      return q.checkoutVerified && !!q.storeKey && !!q.addressKey && !!q.batchKey
        && Number.isSafeInteger(q.totalCents) && q.totalCents >= 0 && q.totalCents <= budgetCents
        && [...needs].every(([key,n]) => (items.get(key) ?? 0) >= n);
    } catch { return false; }
  });
  return candidates.filter(a => !candidates.some(b => dominates(b,a)));
}
export function parseJob(value:unknown):JobInput {
  const x = value as Partial<JobInput> | null;
  if (!x || typeof x.requestID !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(x.requestID)
    || !platforms.includes(x.platform!) || !['search','inspect','history'].includes(x.kind!)
    || typeof x.query !== 'string' || x.query.length > 100
    || (x.kind === 'search' && !x.query.trim()) || !Number.isSafeInteger(x.budgetCents)
    || x.budgetCents! < 0 || x.budgetCents! > 1000000) throw Error('查询条件无效');
  return {requestID:x.requestID, platform:x.platform!, kind:x.kind!, query:x.query.trim(), budgetCents:x.budgetCents!};
}
