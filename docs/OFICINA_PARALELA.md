# Oficina adaptativa con aislamiento

## Política vigente: un Programador por defecto

Desde la decisión posterior al piloto `parallel-dccc1111`, un encargo usa un
Programador de implementación por defecto. Se mantienen las comprobaciones
locales y los especialistas/revisores necesarios según riesgo. Dos escritores
aislados quedan como capacidad experimental conservada, sin promoción automática
por una estimación favorable de tiempo. No se modifica la interfaz.

El ajuste opcional `experimentalParallelWriters` vale `false` por defecto y en
configuraciones antiguas que no lo contienen. La configuración local existente
(`POST /api/team/settings`, protegida por nonce/origen) permite activarlo
explícitamente con `true`; el modelo no puede cambiar ajustes. Un reparto válido
se convierte en un encargo completo con un Programador si el experimento está
apagado; mantiene objetivo, archivos, criterios y comprobaciones globales.
Los planes de IA con varios Programadores se rechazan antes de despachar sus
trabajadores. Un flujo de dos escritores preparado con la opción encendida no
puede arrancar tras desactivarla: se conserva para revisión, sin borrar trabajo.

`maxParallel: 2` sigue siendo el límite global y permite ayudantes de lectura;
por sí solo no activa dos escritores. Seleccionar AO tampoco los activa.
Las pruebas y pilotos experimentales existentes declaran la opción de forma
explícita. No se repiten inferencias ni se autorizan presupuestos por este cambio.

El [piloto real](../reports/paralelismo-real/parallel-dccc1111/RESULTADO.md) acreditó
concurrencia pero se pausó antes de integrar por la reserva de un trabajador.
No demuestra ahorro ni una entrega paralela aceptada. La siguiente prioridad es
reducir contexto y calibrar estimaciones con un Programador; las siguientes
pruebas reales de paralelismo quedan pendientes de autorización nueva.

Codex CLI sigue siendo el motor predeterminado. La nueva capacidad de dos
escritores requiere **Agent Orchestrator seleccionado expresamente**, con su
revisión fijada y sus controles oficiales existentes. No activa automatización
upstream, Claude ni Antigravity. No cambia la interfaz ni los recursos gráficos.

## Papel, instancia y conversación

`role` selecciona el perfil profesional existente. `workerId` identifica al
trabajador; `id` identifica su tarea; `workflowId`, su flujo; `workspaceId`, su
copia acreditada. `executionSessionKey` identifica la conversación del ejecutor.
Dos Programadores comparten instrucciones profesionales, pero tienen distintas
tareas, identidades, conversaciones y carpetas. El puente visual atribuye sus
actividades por trabajador usando los personajes actuales.

Las tareas ordinarias consecutivas conservan la reutilización de personajes.
Esto **no continúa conversaciones**: únicamente `continueTaskId`, compatible
con una tarea terminada, solicita continuación. El revisor siempre comienza una
sesión nueva y de solo lectura. Los checkpoints v1 siguen siendo legibles;
los v2 conservan flujos, contadores y tiempo. Recuperar un estado interrumpido
lo deja pausado y no recrea permisos de workspace ni envía otro encargo.

## Preparar y ejecutar un reparto

La ruta existente `POST /api/team/scope` y la planificación local admiten
`decomposition` opcional. Los clientes anteriores siguen funcionando por orden.
Todas las mutaciones conservan el nonce local y la comprobación de origen.
El cuerpo contiene el proyecto, contexto global, evaluación, permiso de escritura
y este reparto, junto con las comprobaciones **ya registradas en código local**:

```json
{
  "sharedFiles": ["contracts.ts"],
  "parts": [
    {
      "title": "Primer módulo",
      "objective": "Implementa el primer módulo",
      "ownedFiles": ["a.ts"],
      "context": {
        "objective": "Implementa el primer módulo",
        "files": ["a.ts", "contracts.ts"],
        "decisions": ["Respetar el contrato compartido"],
        "acceptance": ["criterio global existente"],
        "checks": ["comprobación local existente"]
      },
      "assessment": {
        "scope": "bounded",
        "risk": "low",
        "uncertainty": "low",
        "modules": ["primer módulo"],
        "tests": "available"
      }
    },
    { "title": "Segunda parte con el mismo esquema y archivos propios distintos" }
  ]
}
```

El ejemplo abreviado requiere completar la segunda parte. No es un comando
ejecutable. No se admiten rutas de workspace, comandos de shell ni presupuestos
generados por el modelo como autorización. Los permisos nacen de capacidades
creadas dentro del gestor. Los contratos compartidos son solo lectura.

Con dependencias declaradas (`dependsOn`, índices de las partes), archivos
compartidos de escritura o archivos de otro trabajador entre las entradas,
el Jefe conserva un Programador por orden. No basta con `parallelSafe`.
Con riesgo o incertidumbre elevados conserva ejecución secuencial y revisión.
No pretende deducir todas las dependencias semánticas de cualquier lenguaje:
la descomposición y el contrato deben aportar evidencia suficiente.

Se asignan modelos mediante la política y los controles manuales existentes.
Antes de arrancar se reserva el conjunto obligatorio: todos los trabajadores y
revisores, preparación, integración y pruebas. La estimación de cada agente
incluye las comprobaciones locales y las instrucciones de propiedad del contexto.
Con menos de cinco medidas comparables o con intentos fallidos/desconocidos no
se calcula una cota optimista de operaciones. Se requiere revisión humana.

La revisión local de cotas usa `POST /api/team/workflow-budget-review` con
`id`, `preparationMs`, `integrationMs` y `sequentialMs`, después de asignar
el flujo y antes de iniciarlo. No cambia los límites globales ni arranca modelos.
Las cotas quedan vinculadas al contexto, base y asignaciones. Con cinco flujos
aceptados comparables se puede reutilizar el máximo observado por 1,5; para la
comparación conservadora se usa la suma estimada de esos mismos dos trabajadores
en secuencia, sin atribuir ese tiempo a Codex individual. No hay promoción
automática de Luna ni afirmación de ahorro de cuota.

## Aislamiento y aceptación

El proyecto original debe tener un commit y estar limpio. La oficina explica
el bloqueo conservando los cambios del usuario. AO prepara dos worktrees desde
el mismo commit. Git puede materializar LF/CRLF de forma diferente: se comprueban
commit, identidad de repositorio y estado limpio; después se sellan los bytes
concretos de cada resultado.

Como máximo se conceden dos plazas de escritura acreditadas para el mismo flujo,
en workspaces distintos. Un tercer escritor, un escritor normal, lectores
incompatibles o un bloqueo desconocido/abandonado impiden otro arranque. No se
borran bloqueos para desbloquear la ejecución automáticamente.

Cada trabajador ejecuta sus pruebas locales y se verifica el alcance real de sus
archivos. Sus traspasos contienen archivos cambiados, huella, pruebas y siguiente
acción. Se generan parches binarios reproducibles con añadidos y eliminaciones
mediante índices privados. Se conservan sus huellas y las copias privadas.
Las dependencias que requieren esas comprobaciones deben estar disponibles en
las copias; esta entrega no ejecuta instaladores ni configura servicios externos
automáticamente. Una comprobación sin su entorno no permite aceptar el resultado.

Una tercera copia recibe ambos parches en orden estable. Sobre ella se ejecutan
todas las comprobaciones y la aceptación global. Se comprueban sus bytes frente
a las aportaciones selladas. Si procede, un revisor independiente recibe el diff
integrado, criterios y pruebas vigentes, sin la conversación del autor.
Antes de aceptar se revalidan candidato y base original.

Conflictos, resultados alterados, pruebas fallidas, recibos perdidos o límites
pausan el flujo. Se cancelan sus procesos activos y se conservan todas las
aportaciones. No se inicia reparación con IA. `candidateProject`, `candidateHash`
y `localChecks` entregan el candidato aceptado en `snapshot.workflows`;
no hay merge, push ni publicación automáticos.

## Recuperación y métricas

Al restaurar un checkpoint, todos los flujos quedan en pausa con
`workflow_recovery_required`, incluidos los que antes figuraban como `accepted`.
Se conservan el candidato, su huella, los resultados de pruebas y los contadores
como evidencia histórica; no equivalen a una aceptación vigente. El reinicio no
recupera las acreditaciones internas del gestor de worktrees y no se concede
autoridad a las rutas del checkpoint. Por ello tampoco se mantiene la aceptación
si el candidato parece intacto. No se recrean espacios, repiten llamadas ni
ejecutan reparaciones automáticamente. La recuperación requiere acreditar y
verificar de nuevo el candidato; esta entrega no añade una reaceptación automática.

El supervisor registra lectura, validación y escritura, causa segura, fase,
antigüedad de la señal y PID con hora de creación cuando están disponibles.
La primera incidencia no se sobrescribe. Se mantienen los plazos anteriores.
Antes de terminar procesos del piloto se comprueban PID y nacimiento; una
identidad no acreditada queda pendiente, sin una terminación por PID a ciegas.
Las escrituras de estado usan archivo temporal y renombrado.

`elapsedMs` mide tiempo de pared activo, incluido cierre; `timeUsedMs` suma
duraciones de trabajo y operaciones, y puede superar el tiempo de pared con
paralelismo. Los flujos conservan preparación e integración por separado.
Los historiales existentes registran entrada, salida, caché y consumo desconocido
por ejecución. La caché forma parte de la entrada; no se suma dos veces ni se
equipara directamente a porcentaje de cuota de la suscripción.
La atribución usa `workflow.taskIds` → tarea → `runId` → recibo e historial de
consumo. Así se distinguen dos Programadores aunque compartan papel. Los
contadores seguros existentes de herramientas, lecturas y turnos siguen ligados
al recibo; no se copian prompts, argumentos de herramientas o mensajes crudos al
informe público.

No se reinician presupuestos al pausar o reiniciar. Un recibo perdido impide
considerar el consumo total conocido. El incidente histórico de supervisión
**continúa indeterminado**: las pruebas nuevas no reconstruyen registros ausentes.

## Validación y futuros pilotos

`node scripts/parallel-evaluation.mjs` ejecuta doce fixtures estructurales y seis
estrategias (72 combinaciones) sin proveedor real. Guarda cada intento en un
informe nuevo; separa calidad, política y finalización. Las pruebas adversas
están en `parallelWorkflow.test.ts`, las de supervisión en
`pilot-supervision.test.mjs`, y `npm run engine:test` usa AO nativo con un
ejecutable local sin modelo, red o credenciales.

`parallel-protocol.mjs` define dos protocolos futuros: controlado con modelo y
razonamiento fijos, y completo adaptativo. Ambos carecen de límites aprobados y
permanecen sin autorización. El baseline individual estricto prohíbe delegación;
un baseline con delegación nativa tendría identidad y resultados separados.
Se necesita cerrar modelos, repeticiones, orden, límites totales y autorización
nueva antes de cualquier piloto. Esta entrega no ejecuta inferencias adicionales.

Los fixtures pequeños comprueban el circuito y sus guardas. No representan el
tamaño real de tareas grandes ni demuestran calidad de un modelo, ahorro de
tokens o aceleración con IA. Esas afirmaciones requieren los pilotos futuros.
