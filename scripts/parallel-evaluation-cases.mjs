// Structural fixtures, deliberately small: these test the circuit, not model ability.
const task = (id, family, reference, assertion, extra = {}) => ({
  id,
  family,
  reference,
  assertion,
  goal: `Implementa ${id} respetando el contrato y las comprobaciones existentes.`,
  ...extra,
});
export const cases = [
  task(
    'clamp',
    'simple',
    { 'a.cjs': 'exports.clamp=(n,min,max)=>Math.max(min,Math.min(max,n));' },
    'assert.equal(a.clamp(-3,0,4),0);assert.equal(a.clamp(9,0,4),4);assert.equal(a.clamp(2,0,4),2);',
  ),
  task(
    'slug',
    'simple',
    { 'a.cjs': "exports.slug=s=>s.trim().toLowerCase().replace(/\\s+/g,'-');" },
    "assert.equal(a.slug('  Hola Mundo  '),'hola-mundo');assert.equal(a.slug(''),'');",
  ),
  task(
    'invoice',
    'dependent',
    {
      'a.cjs': "const b=require('./b.cjs');exports.total=n=>b.tax(n)+n;",
      'b.cjs': 'exports.tax=n=>Math.round(n*.21);',
    },
    'assert.equal(a.total(100),121);assert.equal(a.total(0),0);assert.equal(b.tax(10),2);',
  ),
  task(
    'render-price',
    'dependent',
    {
      'a.cjs': "const b=require('./b.cjs');exports.render=n=>'€'+b.format(n);",
      'b.cjs': 'exports.format=n=>(n/100).toFixed(2);',
    },
    "assert.equal(a.render(123),'€1.23');assert.equal(b.format(0),'0.00');",
  ),
  task(
    'text-and-sum',
    'separable',
    {
      'a.cjs': 'exports.value=s=>s.trim().toUpperCase();',
      'b.cjs': 'exports.value=ns=>ns.reduce((n,x)=>n+x,0);',
    },
    "assert.equal(a.value(' ok '),'OK');assert.equal(b.value([1,2]),3);assert.equal(b.value([]),0);",
    { split: true },
  ),
  task(
    'unique-and-range',
    'separable',
    {
      'a.cjs': 'exports.value=xs=>[...new Set(xs)];',
      'b.cjs': 'exports.value=n=>Array.from({length:Math.max(0,n)},(_,i)=>i);',
    },
    'assert.deepEqual(a.value([2,2,1]),[2,1]);assert.deepEqual(b.value(3),[0,1,2]);',
    { split: true },
  ),
  task(
    'versioned-contract',
    'coupled',
    {
      'a.cjs': "const b=require('./b.cjs');exports.value=n=>b.value({amount:n});",
      'b.cjs': 'exports.value=({amount})=>amount*2;',
    },
    'assert.equal(a.value(4),8);assert.equal(b.value({amount:3}),6);',
  ),
  task(
    'pagination-contract',
    'coupled',
    {
      'a.cjs': "const b=require('./b.cjs');exports.page=xs=>b.pack(xs.slice(0,2),xs.length);",
      'b.cjs': 'exports.pack=(items,total)=>({items,total});',
    },
    'assert.deepEqual(a.page([1,2,3]),{items:[1,2],total:3});assert.deepEqual(b.pack([],0),{items:[],total:0});',
  ),
  task(
    'deny-by-default',
    'sensitive',
    { 'a.cjs': "exports.allowed=r=>r==='admin';" },
    "for(const r of [null,undefined,'user','ADMIN',''])assert.equal(a.allowed(r),false);assert.equal(a.allowed('admin'),true);",
    { risk: 'high' },
  ),
  task(
    'integer-units',
    'sensitive',
    {
      'a.cjs':
        "exports.value=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('invalid');return n*2;};",
    },
    "assert.equal(a.value(5),10);for(const n of [-1,1.5,NaN,'2'])assert.throws(()=>a.value(n));",
    { risk: 'high' },
  ),
  task(
    'cursor-continuity',
    'continuity',
    { 'a.cjs': 'exports.value=(items,cursor)=>items.slice(cursor);' },
    'assert.deepEqual(a.value([1,2,3],1),[2,3]);assert.deepEqual(a.value([1],1),[]);',
    { resume: true },
  ),
  task(
    'retry-idempotency',
    'continuity',
    { 'a.cjs': 'exports.value=(seen,id)=>seen.includes(id)?seen:[...seen,id];' },
    "const first=a.value([],'x');assert.deepEqual(a.value(first,'x'),['x']);assert.deepEqual(a.value(first,'y'),['x','y']);",
  ),
];
export function acceptanceSource(item) {
  return `const assert=require('node:assert/strict');const a=require('./a.cjs');${item.reference['b.cjs'] ? "const b=require('./b.cjs');" : ''}${item.assertion}\n`;
}
