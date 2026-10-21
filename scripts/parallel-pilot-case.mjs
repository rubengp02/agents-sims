export const objective =
  'Implementa parseCsv en csv.mjs y planJobs en graph.mjs para el pipeline de importación, sin modificar contratos ni pruebas.';
export const contracts = {
  'csv.mjs': `parseCsv(text) exige string (TypeError en otro tipo). Devuelve filas de campos string.
Vacío devuelve []. Coma separa campos; LF o CRLF separan filas. Un salto final no añade fila extra.
Una fila vacía interna es ['']; campos vacíos iniciales/finales se conservan. No recorta espacios.
Un campo puede empezar por comillas dobles: dentro admite comas y saltos literalmente y dos
comillas consecutivas representan una comilla. Tras cerrar solo admite coma, salto o fin.
Comillas en campo no entrecomillado, comillas sin cerrar y CR suelto fuera de comillas lanzan SyntaxError.
No muta entradas ni usa dependencias, red, archivos o temporizadores.`,
  'graph.mjs': `planJobs(jobs) exige array de objetos {id, dependsOn}, id string con trim no vacío,
dependsOn array de strings con trim no vacío. Error de tipo/estructura: TypeError.
Ids duplicados, dependencia duplicada, inexistente, propia o ciclo: RangeError.
Devuelve array de capas (arrays de ids). Cada capa contiene todos los pendientes cuyas
dependencias están en capas anteriores, en orden de entrada. No ordena alfabéticamente,
no modifica entradas y no normaliza ids. Vacío devuelve []. Solo dependencias del propio
array. No usa dependencias, red, archivos o temporizadores.`,
};
const csvTests = `import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCsv} from './csv.mjs';
const valid=[['',[]],['a',[['a']]],['a,b',[['a','b']]],['a,b\\n',[['a','b']]],['a,b\\r\\n',[['a','b']]],['\\n',[['']]],['a\\n\\nb',[['a'],[''],['b']]], [',',[['','']]],['a,,',[['a','','']]],[' a , b ',[[' a ',' b ']]],['"a,b",c',[['a,b','c']]],['"a\\nb",c',[['a\\nb','c']]],['"a""b",c',[['a"b','c']]],['"",',[['','']]],['"a\\r\\nb"',[['a\\r\\nb']]]];
valid.forEach(([input,expected],i)=>test('csv valid '+i,()=>assert.deepEqual(parseCsv(input),expected)));
[null,0,{},[],undefined].forEach((v,i)=>test('csv type '+i,()=>assert.throws(()=>parseCsv(v),TypeError)));
['"a','a"b','"a"x','a\\rb','"a" b'].forEach((v,i)=>test('csv syntax '+i,()=>assert.throws(()=>parseCsv(v),SyntaxError)));
`;
const graphTests = `import {test} from 'node:test';import assert from 'node:assert/strict';import {planJobs} from './graph.mjs';
const j=(id,dependsOn=[])=>({id,dependsOn});
const valid=[[[],[]],[[j('a')],[['a']]],[[j('b'),j('a')],[['b','a']]],[[j('b',['a']),j('a')],[['a'],['b']]],[[j('d',['b','c']),j('b',['a']),j('c',['a']),j('a')],[['a'],['b','c'],['d']]],[[j(' a '),j('b',[' a '])],[[' a '],['b']]],[[j('a'),j('b',['a']),j('c')],[['a','c'],['b']]]];
valid.forEach(([input,expected],i)=>test('graph valid '+i,()=>{const before=JSON.stringify(input);assert.deepEqual(planJobs(input),expected);assert.equal(JSON.stringify(input),before)}));
[null,{},'a',[null],[j('')],[j(' ')],[{id:0,dependsOn:[]}],[{id:'a'}],[j('a',null)],[j('a',[2])],[j('a',[''])]].forEach((v,i)=>test('graph type '+i,()=>assert.throws(()=>planJobs(v),TypeError)));
[[j('a'),j('a')],[j('a',['x'])],[j('a',['a'])],[j('a'),j('b',['a','a'])],[j('a',['b']),j('b',['a'])]].forEach((v,i)=>test('graph range '+i,()=>assert.throws(()=>planJobs(v),RangeError)));
`;
export const references = {
  'csv.mjs': `export function parseCsv(text){if(typeof text!=='string')throw new TypeError();if(!text)return [];const rows=[];let row=[],field='',quoted=false,closed=false,start=true;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}if(c==='"'){if(!start||closed)throw new SyntaxError();quoted=true;start=false;continue;}if(c===','||c==='\\n'||c==='\\r'){if(c==='\\r'){if(text[i+1]!=='\\n')throw new SyntaxError();i++;}row.push(field);field='';start=true;closed=false;if(c!==','){rows.push(row);row=[];}continue;}if(closed)throw new SyntaxError();field+=c;start=false;}if(quoted)throw new SyntaxError();if(row.length||field||closed||start&&!text.endsWith('\\n')){row.push(field);rows.push(row);}return rows;}`,
  'graph.mjs': `export function planJobs(jobs){if(!Array.isArray(jobs))throw new TypeError();const ids=new Set();for(const j of jobs){if(!j||typeof j!=='object'||Array.isArray(j)||typeof j.id!=='string'||!j.id.trim()||!Array.isArray(j.dependsOn)||j.dependsOn.some(d=>typeof d!=='string'||!d.trim()))throw new TypeError();if(ids.has(j.id))throw new RangeError();ids.add(j.id);}for(const j of jobs){if(new Set(j.dependsOn).size!==j.dependsOn.length||j.dependsOn.some(d=>!ids.has(d)||d===j.id))throw new RangeError();}const done=new Set(),layers=[];while(done.size<jobs.length){const ready=jobs.filter(j=>!done.has(j.id)&&j.dependsOn.every(d=>done.has(d))).map(j=>j.id);if(!ready.length)throw new RangeError();layers.push(ready);ready.forEach(id=>done.add(id));}return layers;}`,
};
export function caseFiles(reference = false) {
  return {
    'AGENTS.md':
      '# Encargo aislado\nSolo puedes editar csv.mjs y graph.mjs, limitados a tu alcance asignado. No modifiques pruebas, instrucciones ni contratos. Sin archivos nuevos, dependencias, red, commits ni delegación. No continúes sesiones anteriores. Usa node --test csv.test.mjs graph.test.mjs integration.test.mjs para comprobaciones completas. Termina con OFFICE_RESULT {"status":"completed"}, blocked o failed.\n',
    'TASK.md':
      objective +
      '\n\n' +
      Object.entries(contracts)
        .map(([f, c]) => f + '\n' + c)
        .join('\n\n'),
    'csv.mjs': reference ? references['csv.mjs'] : 'export function parseCsv(_text){return [];}\n',
    'graph.mjs': reference
      ? references['graph.mjs']
      : 'export function planJobs(_jobs){return [];}\n',
    'csv.test.mjs': csvTests,
    'graph.test.mjs': graphTests,
    'integration.test.mjs': `import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCsv} from './csv.mjs';import {planJobs} from './graph.mjs';
test('joint import and schedule',()=>{const rows=parseCsv('id,dependencies\\r\\n"publish","compile|lint"\\r\\ncompile,fetch\\r\\nlint,fetch\\r\\nfetch,\\r\\n');const jobs=rows.slice(1).map(([id,deps])=>({id,dependsOn:deps?deps.split('|'):[]}));assert.deepEqual(planJobs(jobs),[['fetch'],['compile','lint'],['publish']]);});
test('joint parsed unknown dependency rejected',()=>{const rows=parseCsv('a,missing');assert.throws(()=>planJobs(rows.map(([id,dep])=>({id,dependsOn:[dep]}))),RangeError);});
`,
  };
}
