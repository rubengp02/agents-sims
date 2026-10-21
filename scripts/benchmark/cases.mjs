const commonGuide = `# Proyecto de comparación aislado
Trabaja únicamente en los archivos permitidos en TASK.md. Conserva TASK.md,
AGENTS.md, package.json y contract.test.mjs. No añadas dependencias, red, commits,
ramas ni archivos nuevos. No delegues ni uses otros proveedores o credenciales.
Usa node --test contract.test.mjs para las pruebas públicas disponibles.
La aceptación externa comprueba el contrato completo aunque las pruebas públicas pasen.
Termina con OFFICE_RESULT {"status":"completed"}, o blocked/failed si corresponde.
`;

export const CASES = [
  {
    id: 'easy',
    label: 'Fácil: normalizar etiquetas',
    effort: 'low',
    objective:
      'Corrige normalizeLabel en label.mjs conservando su export y sin modificar otros archivos.',
    contract: `normalizeLabel(value) exige un string y lanza TypeError para cualquier otro tipo.
Recorta espacios al principio y al final, convierte cada grupo de espacios Unicode
internos (incluidos tabuladores y saltos de línea) en un espacio ASCII y pasa a
minúsculas con toLowerCase. Conserva acentos y puntuación. El string vacío es válido.
No cambia el valor de entrada ni hace conversiones implícitas de tipos.`,
    files: ['label.mjs'],
    assessment: {
      scope: 'bounded',
      risk: 'low',
      uncertainty: 'low',
      modules: ['label'],
      tests: 'available',
    },
    initial: {
      'label.mjs':
        'export function normalizeLabel(value) { return String(value).trim().toLowerCase(); }\n',
    },
    reference: {
      'label.mjs':
        'export function normalizeLabel(value) { if (typeof value !== "string") throw new TypeError("string required"); return value.trim().replace(/\\s+/gu, " ").toLowerCase(); }\n',
    },
    smoke: `import { normalizeLabel } from './label.mjs';
assert.equal(normalizeLabel('  HoLA  '), 'hola');
assert.equal(normalizeLabel('UNO   DOS'), 'uno dos');
assert.throws(() => normalizeLabel(null), TypeError);`,
    limits: { maxRuns: 2, maxTokens: 60000, reservePerRun: 30000, perRunMs: 90000, maxMs: 240000 },
    order: ['direct', 'office'],
    expectedOfficeRoles: ['developer'],
  },
  {
    id: 'medium',
    label: 'Media: factura en céntimos',
    effort: 'medium',
    objective:
      'Implementa parseCents en money.mjs y calculateInvoice en invoice.mjs según el contrato, conservando exports.',
    contract: `parseCents(value) acepta únicamente strings con patrón ^(0|[1-9][0-9]*)\\.[0-9]{2}$,
sin espacios, signos ni notación exponencial. Devuelve céntimos enteros seguros;
lanza TypeError ante sintaxis/tipo incorrectos y RangeError si excede MAX_SAFE_INTEGER.
calculateInvoice(lines, discountBps=0) recibe un array, posiblemente vacío, de
{price: string, quantity: entero entre 1 y 1000}. Usa parseCents para cada precio.
discountBps debe ser entero entre 0 y 10000. Array/objeto/tipos incorrectos lanzan
TypeError; cantidad/descuento fuera de rango y subtotal inseguro lanzan RangeError.
Calcula subtotalCents como suma exacta de priceCents*quantity. Aplica el descuento
una sola vez al subtotal; discountCents se redondea al entero más cercano, con .5
hacia arriba. Devuelve {subtotalCents, discountCents, totalCents}. Sin coma flotante
para los cálculos monetarios, sin mutar entradas. No modifica otras claves del contrato.`,
    files: ['money.mjs', 'invoice.mjs'],
    assessment: {
      scope: 'cross-module',
      risk: 'low',
      uncertainty: 'low',
      modules: ['money', 'invoice'],
      tests: 'available',
    },
    initial: {
      'money.mjs':
        'export function parseCents(value) { return Math.round(Number(value) * 100); }\n',
      'invoice.mjs': `import { parseCents } from './money.mjs';
export function calculateInvoice(lines, discountBps=0) { const subtotalCents=lines.reduce((s,l)=>s+parseCents(l.price)*l.quantity,0); const discountCents=Math.floor(subtotalCents*discountBps/10000); return {subtotalCents,discountCents,totalCents:subtotalCents-discountCents}; }\n`,
    },
    reference: {
      'money.mjs': `export function parseCents(value) {
if(typeof value!=='string'||!/^(0|[1-9][0-9]*)\\.[0-9]{2}$/.test(value)) throw new TypeError('price');
const [whole,part]=value.split('.'); const cents=BigInt(whole)*100n+BigInt(part);
if(cents>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('price'); return Number(cents);
}\n`,
      'invoice.mjs': `import { parseCents } from './money.mjs';
export function calculateInvoice(lines,discountBps=0) {
if(!Array.isArray(lines)||typeof discountBps!=='number') throw new TypeError('types');
if(!Number.isInteger(discountBps)||discountBps<0||discountBps>10000) throw new RangeError('discount');
let sum=0n; for(const line of lines) {
if(!line||typeof line!=='object'||Array.isArray(line)||typeof line.quantity!=='number') throw new TypeError('line');
if(!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>1000) throw new RangeError('quantity');
sum+=BigInt(parseCents(line.price))*BigInt(line.quantity); }
if(sum>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('subtotal');
const discount=(sum*BigInt(discountBps)+5000n)/10000n;
return {subtotalCents:Number(sum),discountCents:Number(discount),totalCents:Number(sum-discount)};
}\n`,
    },
    smoke: `import { parseCents } from './money.mjs';
import { calculateInvoice } from './invoice.mjs';
assert.equal(parseCents('1.25'),125);
assert.throws(()=>parseCents('1e2'), TypeError);
assert.deepEqual(calculateInvoice([{price:'0.01',quantity:1}],5000), {subtotalCents:1,discountCents:1,totalCents:0});`,
    limits: { maxRuns: 4, maxTokens: 120000, reservePerRun: 30000, perRunMs: 90000, maxMs: 360000 },
    order: ['office', 'direct'],
    expectedOfficeRoles: ['architect', 'developer', 'tester'],
  },
  {
    id: 'hard',
    label: 'Difícil: cola concurrente e idempotente',
    effort: 'high',
    objective:
      'Corrige la cola de tareas con concurrencia, cancelación e idempotencia en queue.mjs y validation.mjs.',
    contract: `createQueue({concurrency}) exportada por queue.mjs exige un entero entre 1 y 8.
Exporta validateConcurrency desde validation.mjs: tipos no number lanzan TypeError;
números no enteros o fuera de rango lanzan RangeError. La cola expone submit(id,job),
cancel(id), idle(), stats(). submit exige id string no vacío y job función, con
TypeError síncrono en entradas inválidas. Cada job recibe su AbortSignal.
Los jobs empiezan en orden FIFO, hasta concurrency. Repetir un id válido devuelve
exactamente la misma Promise durante y después del trabajo, sin ejecutar el job nuevo.
Resolver conserva el valor; rechazar conserva el error. Un throw síncrono no rompe
la cola ni ocupa una plaza. Los trabajos finalizados no vuelven a ejecutarse.
cancel(id) devuelve true solo la primera vez que cancela una tarea pendiente/activa;
false para desconocidas o ya terminadas/canceladas. Cancelar una pendiente no ejecuta
su job y rechaza su Promise con error.name='AbortError'. Cancelar una activa aborta
su señal pero conserva su plaza hasta que su job realmente termina; entonces su
Promise rechaza AbortError incluso si el job resolvió. Sin cancelación implícita de
otras tareas. idle() resuelve cuando no queda trabajo pendiente ni activo.
stats() devuelve una copia {running,queued,completed,cancelled,failed}; completed y
failed cuentan resultados asentados, cancelled cuenta cancelaciones aceptadas una
sola vez. Una tarea cancelada no cuenta como completed/failed. No hay polling, red,
temporizadores ni dependencias externas. Solo se permite modificar los dos módulos.`,
    files: ['queue.mjs', 'validation.mjs'],
    assessment: {
      scope: 'cross-module',
      risk: 'high',
      uncertainty: 'high',
      modules: ['queue', 'validation'],
      tests: 'available',
    },
    initial: {
      'validation.mjs': 'export function validateConcurrency(value) { return Number(value)||1; }\n',
      'queue.mjs': `import { validateConcurrency } from './validation.mjs';
export function createQueue({concurrency}) { validateConcurrency(concurrency); return {submit(_id,job){return Promise.resolve().then(()=>job(new AbortController().signal));},cancel(){return false;},idle(){return Promise.resolve();},stats(){return {running:0,queued:0,completed:0,cancelled:0,failed:0};}}; }\n`,
    },
    reference: {
      'validation.mjs': `export function validateConcurrency(value) { if(typeof value!=='number') throw new TypeError('concurrency'); if(!Number.isInteger(value)||value<1||value>8) throw new RangeError('concurrency'); return value; }\n`,
      'queue.mjs': `import { validateConcurrency } from './validation.mjs';
export function createQueue({concurrency}) {
const limit=validateConcurrency(concurrency), tasks=new Map(), pending=[], waiters=[];
let running=0,completed=0,cancelled=0,failed=0;
const abort=()=>Object.assign(new Error('cancelled'),{name:'AbortError'});
function wake(){if(!running&&!pending.length) for(const resolve of waiters.splice(0)) resolve();}
function drain(){while(running<limit&&pending.length){const t=pending.shift(); t.state='running'; running++;
Promise.resolve().then(()=>t.job(t.controller.signal)).then(value=>finish(t,null,value),error=>finish(t,{error}));} wake();}
function finish(t,rejected,value){running--; t.state='done'; if(t.cancelled)t.reject(abort());else if(rejected){failed++;t.reject(rejected.error);}else{completed++;t.resolve(value);} drain();}
return {submit(id,job){if(typeof id!=='string'||!id.trim()||typeof job!=='function')throw new TypeError('task');
if(tasks.has(id))return tasks.get(id).promise;
const t={job,controller:new AbortController(),state:'queued',cancelled:false};
t.promise=new Promise((resolve,reject)=>{t.resolve=resolve;t.reject=reject;});tasks.set(id,t);pending.push(t);drain();return t.promise;},
cancel(id){const t=tasks.get(id);if(!t||t.state==='done'||t.cancelled)return false;
t.cancelled=true;cancelled++;t.controller.abort();if(t.state==='queued'){pending.splice(pending.indexOf(t),1);t.state='done';t.reject(abort());drain();}return true;},
idle(){return !running&&!pending.length?Promise.resolve():new Promise(resolve=>waiters.push(resolve));},
stats(){return {running,queued:pending.length,completed,cancelled,failed};}};
}\n`,
    },
    smoke: `import { createQueue } from './queue.mjs';
const queue=createQueue({concurrency:1});
const p=queue.submit('a',()=>42);
assert.equal(queue.submit('a',()=>0),p);
assert.equal(await p,42);
await queue.idle();
assert.equal(queue.stats().completed,1);`,
    limits: {
      maxRuns: 4,
      maxTokens: 160000,
      reservePerRun: 40000,
      perRunMs: 120000,
      maxMs: 480000,
    },
    order: ['direct', 'office'],
    expectedOfficeRoles: ['architect', 'developer', 'tester'],
  },
];

export function fixtureFiles(item, reference = false) {
  return {
    'AGENTS.md': commonGuide,
    'TASK.md': `${item.objective}\n\n${item.contract}\n\nArchivos permitidos: ${item.files.join(', ')}.\nDatos de alcance: ${JSON.stringify(item.assessment)}.\nPruebas públicas: node --test contract.test.mjs.\n`,
    'package.json':
      JSON.stringify(
        {
          name: `comparison-${item.id}`,
          private: true,
          type: 'module',
          scripts: { test: 'node --test contract.test.mjs' },
        },
        null,
        2,
      ) + '\n',
    'contract.test.mjs': `import assert from 'node:assert/strict';\n${item.smoke}\n`,
    ...(reference ? item.reference : item.initial),
  };
}
