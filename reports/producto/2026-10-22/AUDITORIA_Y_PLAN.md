# Agents Sims: auditoría de producto y propuesta pendiente de aprobación

Fecha: 22 de octubre de 2026. Código auditado: `59fdf10242954336966a2dcf3903c12ccb745b6f`.
Esta entrega es análisis y documentación. No modifica aplicación, arquitectura,
configuración, personajes o diseño; no autoriza ni ejecuta inferencias.

## Conclusión

Tenemos un ejecutor con controles importantes y una oficina capaz de representar
trabajo real. Todavía no tenemos un recorrido cotidiano que resuelva de forma
continua «proyecto → petición → cambios → aceptación». El panel avanzado permite
administrar la infraestructura, pero sigue pidiendo que la persona haga parte
del trabajo de coordinación.

La siguiente inversión debe unir los mecanismos existentes en un encargo normal
con un Codex y comprobaciones locales. No propongo otro motor, framework,
coordinador, sistema de worktrees ni una gran reorganización del código.

| Categoría                                     | Diagnóstico breve                                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funciona                                      | Ejecución oficial, controles económicos, cola, checks locales, dependencias, revisión por diff y aislamiento opcional.                                                              |
| Existe pero es incómodo                       | Introducir carpetas, elegir entre tres entradas, proporcionar criterios/IDs y revisar reservas por tarea.                                                                           |
| Preparado pero desconectado del uso cotidiano | Saltarse planificación IA con evidencia local, correlacionar personaje/tarea/recibo, usar métricas detalladas y continuación explícita.                                             |
| Falta realmente                               | Proyecto confiable seleccionable, contrato y aceptación comunes del encargo individual, decisiones humanas comprensibles, métricas completas de intervención y recuperación guiada. |
| Simplificable                                 | Configuración repetida y selección por costumbre de especialistas; mantener las capacidades avanzadas fuera del recorrido normal, previa aprobación de su representación.           |

## Estado exacto y evidencia

- Árbol limpio al comenzar. `main` local termina en `59fdf10`.
- Consulta directa a `origin`: `main` remoto termina en `28c3772`; hay seis
  commits locales posteriores, no cambios remotos posteriores que incorporar.
- GitHub CI de `28c3772`: [ejecución 39691169708](https://github.com/rubengp02/agents-sims/actions/runs/39691169708),
  finalizada correctamente. No valida `59fdf10`. No se ha hecho push ni lanzado
  Actions sobre otra revisión presentándola como si fuera la local.
- Se consultó la integración GitHub para metadatos. Su consulta disponible de
  ejecuciones por commit filtra eventos de PR; para comprobar también los eventos
  de push se utilizó `gh run list` con el repositorio explícito, en lectura.
- Reejecución local en esta auditoría: 88/88 pruebas en `teamCoordinator`,
  `teamRoutes`, `adaptiveRuntime` y `teamOfficeBridge` (10,61 s); dos recorridos de
  navegador de equipo (12,9 s). Los proveedores están simulados; HTTP, navegador,
  Git y comprobaciones mecánicas son reales. No son benchmarks de productividad.
- Las 694 pruebas de servidor, 59 de visor, ocho de navegador y el empaquetado
  del informe de controles visuales son evidencia de la entrega anterior, no
  nuevas ejecuciones completas de esta auditoría.
- No se reejecutó `verify:local`: escribe en un informe histórico. Los nuevos
  resultados permanecen en logs locales y en este informe nuevo.

Fuentes principales: [panel](../../../webview-ui/src/components/TeamPanel.tsx),
[formulario de alcance](../../../webview-ui/src/components/TeamScopeForm.tsx),
[tarjetas de flujo y reservas](../../../webview-ui/src/components/TeamWorkflowCard.tsx),
[coordinador](../../../server/src/execution/teamCoordinator.ts),
[rutas locales](../../../server/src/execution/teamRoutes.ts),
[arranque](../../../server/src/cli.ts),
[política](../../../server/src/execution/teamPolicy.ts),
[clasificación](../../../server/src/execution/taskAssessment.ts),
[adaptación](../../../server/src/execution/adaptiveRuntime.ts),
[estimador](../../../server/src/execution/budgetEstimator.ts),
[registro local](../../../server/src/execution/localChecks.ts),
[puente visual](../../../server/src/execution/teamOfficeBridge.ts),
[contrato de equipo](../../../core/src/team.ts).

Se siguió la guía `ecc:click-path-audit` para el panel y su estado compartido,
con inspección del arranque, ejecuciones, pruebas y salida. No se auditó cada
botón del editor visual ni toda la extensión VS Code.

## Objetivo 1: recorrido diario

| Paso                 | Lo que ya funciona                                                                       | Dónde se interrumpe                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abrir                | Lanzador, reutilización del servidor, navegador y oficina                                | El motor y el registro de pruebas nacen ligados al directorio de arranque. No hay incorporación guiada de otro proyecto.                                                                                                                    |
| Seleccionar proyecto | Se valida una carpeta real al crear tareas                                               | Es una entrada de ruta completa, sin catálogo de proyectos ni selector cotidiano. `project` es estado local del panel y se pierde al cerrarlo.                                                                                              |
| Escribir petición    | Texto natural y permiso explícito de escritura                                           | Hay tres entradas diferentes: plan del Jefe, tarea directa y contrato acotado. La persona debe saber cuál necesita.                                                                                                                         |
| Decidir estrategia   | Clasificación local, planificación IA opcional en servidor, modelos manuales/automáticos | El botón del Jefe envía solo proyecto, texto y permiso: no aporta el contexto local necesario para saltarse esa planificación. El formulario sin IA exige archivos, pruebas y valoración manual.                                            |
| Autorizar y arrancar | Origen local, nonce, catálogo, suscripción, reservas, cola y pausa                       | En frío, sin historial comparable, la aplicación bloquea y pide cotas numéricas por tarea. Una planificación IA también puede necesitar esa revisión antes de ejecutarse. No hay estimación fiable universal que permita ocultar este paso. |
| Trabajar             | Codex, dependencias, actividad real, permisos, worktrees opcionales                      | La actividad de herramientas se comunica al observador, pero no hay fase de producto persistente que una implementación, pruebas, espera humana e integración.                                                                              |
| Comprobar            | Ejecución mecánica fuera de la IA, revisión independiente por diff                       | Se requiere contexto con IDs de pruebas; una tarea directa ordinaria no lo trae. El registro del arranque es específico de Pixel Office, no de la carpeta elegida.                                                                          |
| Recibir resultado    | Respuesta del agente, estados, resultados locales, candidato integrado                   | Falta una entrega única del encargo individual con diff, aceptación completa, evidencias, consumo e incidencias. `completed` de tarea no significa por sí solo aceptación independiente de todo el producto.                                |
| Volver mañana        | Checkpoints y contadores, sin repetición automática                                      | Todos los flujos recuperados quedan en pausa; no existe recorrido guiado de reacreditación. Un flujo pausado impide `start()` y `resume()` de la cola común, incluso para un encargo nuevo.                                                 |

### Un límite importante de «seleccionar cualquier proyecto»

`cli.ts` construye una sola pareja de ejecutores, un registro `pixelOfficeChecks`
y un historial desde `process.cwd()`. El panel puede enviar otra carpeta, pero
eso no crea su perfil de pruebas. `pixelOfficeChecks()` exige archivos propios
de Pixel Office y limita los comandos a su proyecto autorizado. Reutilizar la
lista visible del catálogo no convierte sus pruebas en pruebas de otro proyecto.

Por tanto, necesitamos vincular proyecto, registro confiable, permisos e
historial; no basta con sustituir el campo de texto por un desplegable. No debe
ejecutarse automáticamente cualquier script que aparezca en un repositorio.

### Seguimiento de acciones y efectos de estado

| Acción actual           | Secuencia observada                                                                                       | Consecuencia para el uso diario                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abrir Equipo            | Monta `TeamPanel`, consulta estado y planificación, actualiza cada 1,2 s                                  | No consume inferencia. Los borradores no viven fuera del componente.                                                                                                                                                                    |
| Cerrar Equipo           | Desmonta el componente                                                                                    | Se pierden carpeta, texto y borrador del formulario avanzado. La ejecución del servidor continúa.                                                                                                                                       |
| Pedir plan al Jefe      | `POST plan` → `team.plan()` sin paquete local → llamada del Jefe → JSON validado → nuevas tareas          | No es el camino de un único Codex completo. Puede requerir una llamada de planificación más las tareas y reservas.                                                                                                                      |
| Añadir tarea sin plan   | `POST tasks` con rol/texto/permiso; después vacía el objetivo                                             | Evita el Jefe, pero no construye contrato, pruebas ni revisión del encargo completo. No es sustituto seguro del recorrido normal.                                                                                                       |
| Preparar encargo sin IA | Construye contrato/valoración/reparto → `POST scope`                                                      | Funciona sin modelo, pero exige conocimiento técnico. Los errores del servidor sí se muestran.                                                                                                                                          |
| Guardar ajustes         | Envía todos los ajustes → `configure()` → invalida elección/confirmación de tareas planificadas o en cola | Incluso una configuración idéntica invalida asignaciones. Es un comportamiento deducido directamente del código, no una regresión demostrada en navegador en esta auditoría.                                                            |
| Comprobar asignación    | Diagnóstico de CLI → catálogo → elección → estado preparado/bloqueado                                     | Existe la infraestructura adecuada; no es inferencia de implementación. Puede repetirse entre asignación y ejecución, por seguridad.                                                                                                    |
| Guardar cotas           | Revisión vinculada al perfil → persiste, sin ejecutar                                                     | Correcto y probado. Pide tokens, segundos y caracteres que una persona normal no tiene por qué saber estimar.                                                                                                                           |
| Ejecutar cola           | Asigna/encola → reserva plan completo → prepara espacios si procede → ejecuta                             | En manual/mixto conserva confirmaciones. Un bloqueo detiene el proceso con un código, sin alternativa de pago.                                                                                                                          |
| Terminar un CLI         | Actualiza observador con el recibo → valida resultado → ejecuta pruebas del contexto                      | El avatar puede pasar a reposo antes de terminar las comprobaciones: el puente considera reposo todo recibo distinto de `running`. Es una discrepancia posible identificada por trazado; falta regresión específica de fase de pruebas. |
| Recuperar flujo         | Lee checkpoint → pausa → conserva evidencia                                                               | Seguro frente a aceptación obsoleta. No hay botón legítimo para reconstruir acreditaciones y verificar de nuevo; no debe inventarse una reanudación automática.                                                                         |

La lectura por sondeo y la actualización tras mutaciones pueden coincidir; no
hay número de revisión para descartar una respuesta antigua. Es un riesgo de
estado a probar con latencia, no un fallo reproducido aquí.

## Objetivo 2: eficiencia de la estrategia

### Lo que ya funciona

- Codex CLI es la selección inicial en `engine.ts`. AO se selecciona expresamente
  mediante configuración y conserva los controles de suscripción.
- Dos escritores están desactivados inicialmente. Se exige aislamiento,
  propiedad, mismo commit, estimaciones e integración; dos plazas por sí solas
  no habilitan escrituras concurrentes.
- `plan()` puede evitar una consulta del Jefe si recibe valoración local clara.
- `addScopedWorkflow()` puede usar un Programador y pruebas locales si hay
  aceptación acreditada; conserva revisiones ante falta de evidencia.
- El revisor usa sesión independiente, solo lectura, diff, criterios y pruebas;
  exige hallazgos con archivo, línea, criterio y evidencia. Hay opción profunda.
- Historial, cotas completas y pausas ante consumo desconocido evitan tratar
  fallos como coste cero. Una pausa no regala presupuesto nuevo.
- Modelos y razonamiento se contrastan con el catálogo del CLI. La promoción
  automática de Luna para código exige un perfil aprobado y evidencia; el
  conjunto de perfiles de producción nace vacío. Los modos manual y mixto existen.

### Lo incómodo o no terminado

Un Programador no implica un único agente: el Jefe puede planificar por separado,
la clasificación conserva Tester cuando falta evidencia y el usuario debe
aportar precisamente esa evidencia para evitarlo. No proponemos quitar el
revisor sin sustituir esa ausencia por aceptación verificable.

La política de modelos es un catálogo curado y reglas, no un optimizador
comparativo de consumo final, calidad y reparaciones. Para explicaciones el
selector prefiere Luna por dificultad; el bloqueo adicional de evidencia cubre
código, no todos los papeles. La propuesta del Jefe también admite combinaciones
sin que exista un ranking comparativo general. Debemos distinguir «combinación
disponible» de «combinación demostrada como eficiente».

La planificación pide dividir en una a cuatro tareas y contiene instrucciones
de ordenar arquitectura, código y QA. Aunque prohíbe personajes innecesarios,
el punto de entrada orienta a un plan de equipo. Falta una decisión de producto
previa: «un ejecutor resuelve este encargo» frente a «necesita esta ampliación
por este motivo y con este coste». Puede ser local; no debe convertirse en
una nueva consulta IA obligatoria.

El estimador requiere cinco turnos completos comparables para confianza medida;
los ejemplos incompletos o contextos mayores fuerzan revisión. Esto es conservador
y útil, pero no hay todavía una experiencia sencilla de primer uso ni una
estimación automática universal defendible. La cuota incluida tampoco puede
inferirse de precios API o de un descuento supuesto por caché.

### Criterio propuesto, aún no aplicado

1. Encargo cotidiano con aceptación disponible: un Codex y comprobaciones locales.
2. Duda acotada: resolverla en el mismo trabajo si el permiso y la reserva lo
   permiten; no crear otro personaje automáticamente.
3. Riesgo o incertidumbre que las pruebas no cubren: justificar revisión
   independiente adicional, con criterio concreto que se espera comprobar.
4. Planificación especializada: solo si hay decisión estructural necesaria.
5. Dos escritores: experimento opcional, contrato congelado, propiedad separada,
   aceptación conjunta y coste completo favorable con evidencia suficiente.
6. Fallo inicial: conservar causa, recibo y estado; una reparación es una nueva
   acción acotada dentro del presupuesto restante, nunca un bucle sin límite.

El Jefe es la responsabilidad de decidir, no la obligación de otra inferencia.
La primera versión no promocionaría nuevos modelos ni continuaciones de sesiones.

## Objetivo 3: productividad real

Tenemos analizadores de consumo, recibos, protocolos, autorización por huella,
pruebas de protección, estudios de contexto y pilotos reales históricos. Deben
reutilizarse. La matriz de 72 combinaciones comprueba el circuito; sus ejemplos
son pequeños y no sirven como evaluación de productividad de los modelos.

La evidencia real no avala una superioridad general. El piloto paralelo más
reciente acreditó concurrencia, pero acabó en pausa sin candidato integrado:
individual 50/50, 43.363 tokens, 41,246 s; oficina al menos 131.363 observados,
total final desconocido, 48,878 s hasta pausa. No son tiempos de entrega
equivalentes. El estudio previo de tres agentes tampoco fue una mejora admitida.
El resultado adaptativo previo de 73.177 tokens y 48,596 s frente a 60.341 y
71,676 s corresponde a otro ensayo acotado; no demuestra reducción de consumo
ni se combina como promedio con las otras familias.

Fuentes históricas: [piloto paralelo](../../paralelismo-real/parallel-dccc1111/RESULTADO.md),
[tres agentes](../../agent-orchestrator/revalidacion-20261021-c/RESULTADO.md) y
[piloto del Jefe adaptativo](../../optimizacion-adaptativa/validacion-jefe/piloto/RESULTADO.md).

Se proponen [15 encargos reales](CASOS_15.md) y un
[protocolo de comparación y límites](EVALUACION.md). Son especificaciones para
aprobar, no quince entornos ejecutables ya construidos. Antes de cada ejecución
faltan fijar base, aceptación externa y preparación reproducible del caso.
El protocolo no contiene autorización de ejecución ni se añade otro ejecutor.

La intervención humana y los defectos que escapan no están medidos de manera
completa en la experiencia actual. `repair` se conserva como desconocido cuando
no se puede acreditar. La aceptación del historial por tarea requiere checks
locales, pero no equivale a la aceptación integrada del encargo. Eso impide usar
el historial como si ya demostrase productividad final.

## Objetivo 4: entender la oficina sin rediseñarla

| Necesidad                        | Fuente existente                                               | Carencia que debemos resolver antes del diseño                                                                                                           |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarea por personaje              | `TeamTask.agentId`, `workerId`, título y papel; puente visual  | El personaje usa papel/modelo en su nombre, sin una vista conjunta del encargo que explique su participación.                                            |
| Proveedor, modelo y razonamiento | `choice`, override y modelo confirmado opcional                | El modelo confirmado puede ser desconocido. El nombre del personaje no comunica todos los datos; el panel sí muestra la elección solicitada.             |
| Actividad real                   | Eventos `thinking/reading/working`, herramientas y estados     | No están persistidos como fase y antigüedad en `TeamSnapshot`; pruebas e integración no tienen el mismo detalle de actividad que el CLI.                 |
| Cuántos y por qué                | Tareas, dependencias, `scheduleReason`, `workflow.reason`      | Falta un resumen por petición, con decisión y coste de ampliar equipo.                                                                                   |
| Paralelismo                      | Identidades, workspaces, estados y modo del flujo              | La duración y concurrencia efectiva por trabajador no se exponen de forma consistente; el modo propuesto no debe confundirse con concurrencia observada. |
| Pruebas                          | Catálogo confiable y resultados `localChecks`                  | Resultados al finalizar, sin inicio/fin/estado actual por comprobación ni distinción uniforme entre no ejecutada, cancelada y fallida.                   |
| Tiempo                           | Recibos y acumuladores globales; preparación/integración       | Faltan fecha de solicitud y aceptación por encargo y cronología por tarea en el contrato del panel.                                                      |
| Consumo                          | Entrada/salida/caché, `observedUsage`, recibos e historial     | El panel tiene un total global. No expone consistentemente desglose por ejecución ni observaciones parciales con su procedencia.                         |
| Cambios y lugar                  | Revisiones, paquetes diff y candidato AO                       | En el trabajo individual no hay entrega normalizada equivalente; la captura inicial se hace cuando hay un revisor dependiente, no en todo encargo.       |
| Decisión humana                  | Razones de bloqueo, permisos, confirmación y revisión de cotas | No hay objeto estructurado de decisión pendiente con motivo, alternativas seguras y alcance exacto de la autorización.                                   |

Propuesta funcional, no propuesta de colores, distribución o animación: preparar
un resumen de encargo con estrategia, fase real, pruebas, cambios y decisiones.
Los valores desconocidos permanecerán desconocidos; nunca convertir tiempo de
sondeo en tiempo real del proveedor ni uso de personaje en sesión continuada.
Después presentaremos al director creativo alternativas de representación y
no modificaremos la interfaz sin su aprobación.

## Qué conservar, simplificar y aplazar

| Conservar y reutilizar                            | Simplificar                                                                                                                     | Aplazar                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CLIs oficiales y controles de suscripción         | Unificar tres entradas en un recorrido normal y un modo avanzado, previa aprobación visual                                      | Más motores, proveedores y frameworks            |
| Coordinator, cola, dependencias, modos y permisos | Eliminar configuración repetida de pruebas/proyecto mediante perfil confiable                                                   | Promoción de modelos ligeros sin comparación     |
| Checks locales, catálogo y revisor por diff       | No invalidar asignaciones al guardar ajustes idénticos; preservar borradores                                                    | Continuación automática y más de dos escritores  |
| Historial y estimador conservador                 | Una revisión comprensible del primer presupuesto en lugar de cotas técnicas por personaje cuando haya evidencia para agruparlas | Más simulaciones presentadas como eficacia real  |
| AO opcional, worktrees, integración y evidencia   | Entrega común individual/equipo; separar éxito de CLI y aceptación                                                              | Más controles técnicos en el recorrido principal |
| Escenario, personajes, editor y animaciones       | Consolidar futuros protocolos sobre el verificador existente, conservando informes y reproductores históricos                   | Borrar capacidades o reescribir el coordinador   |

No se elimina código en esta entrega. La reducción buscada es de pasos y
decisiones, no de controles de calidad o de permisos.

## Plan pequeño, por entregas que requieren aprobación

| Orden | Mejora y problema que resuelve                                                                                                                                     | Reutilización                                                                     | Cómo la aceptaremos                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Perfil confiable de proyecto y primer uso. Evita rutas y pruebas del proyecto equivocado.                                                                          | Validación de carpetas, catálogo de checks, estado local y adaptador existente    | Registrar una vez; reabrir y seleccionar por nombre. Asociar pruebas solo al proyecto autorizado. Ninguna inferencia o comando por abrir. Sin cargar automáticamente scripts arbitrarios. Propuesta visual previa.                                                                                          |
| 2     | Un encargo con una entrega verificable. Une texto natural, estrategia inicial individual, ejecución y aceptación.                                                  | `addTask`, `addScopedWorkflow`, `start`, checks, captura de revisión y resultados | Un cambio cotidiano en proyecto registrado llega a aceptación local con un Codex y sin rellenar contratos. Si falta alcance/aceptación o hay riesgo, pregunta concreta y pausa, no aceptación inventada. Pruebas fallidas nunca cuentan como éxito.                                                         |
| 3     | Primer presupuesto y nueva tanda comprensibles. Evita bloquear al usuario con tokens/caracteres por personaje y evita que un flujo antiguo secuestre toda la cola. | Estimador, historial, cotas manuales y checkpoints                                | Mantener una revisión humana explícita en frío. Mostrar límite total, base de estimación y reserva obligatoria; sin extrapolar datos no comparables ni elevar límites. Encargos nuevos no reanudan ni resetean los anteriores. Primero delimitar el contrato de esta separación; sin reescribir el runtime. |
| 4     | Escalado selectivo y medible. Evita Jefe IA/Arquitecto/Tester por hábito.                                                                                          | Clasificación local, política de modelos, aceptación y review packets             | Casos de referencia: simple con checks → un Codex; riesgo sin cubrir → revisor justificado; falta de presupuesto → cero arranques adicionales; dos partes acopladas → secuencial. Modos manual/mixto siguen efectivos. No introducir otra llamada para clasificar cada petición.                            |
| 5     | Congelar la evaluación y ejecutar solo lo autorizado después. Evita medir pequeños ejemplos como productividad.                                                    | Protocolos y verificadores, recibos, aceptación externa y límites existentes      | Los 15 contratos son reproducibles; base rota demuestra que la aceptación detecta el problema; pruebas protegidas y candidatos independientes. Revisar límites y aprobar primero una pareja, no toda la batería de golpe. Ningún modelo se ejecuta durante la preparación.                                  |
| 6     | Datos de producto y propuesta visual. Explica el trabajo real sin otro panel técnico.                                                                              | `TeamTask`, recibos, puente y mensajes existentes                                 | Datos correlacionados por encargo/ejecución, pruebas en curso y decisiones pendientes. Reconciliación tras recarga; datos sensibles fuera del canal. El usuario aprueba primero representación y distribución; solo después se toca UI.                                                                     |

El orden describe hitos de producto, no commits gigantes. Cada fila se divide
en contratos, pruebas y conexión mínimos. Los bloqueos de seguridad que aparezcan
son condiciones de aceptación del propio hito, no un motivo para retirarlos.

La instrumentación mínima de la entrega y de las intervenciones empieza con el
hito 2, para poder medir el recorrido. El diseño visual completo sigue al final;
los cambios imprescindibles de selección/aprobación de los hitos 1–3 también se
presentan al usuario antes de alterar el panel.

### Primera entrega que recomiendo aprobar

Acotar únicamente el perfil de proyecto y el camino de una tarea individual,
empezando por Pixel Office como proyecto conocido. Primero perfil, pruebas de
asociación y borrador persistente durante la sesión; después resultado único y
aprobación de presupuesto con datos suficientes. No empezar ahora por dos
escritores ni por otra ronda de modelos.

Éxito medible: una persona que no conoce IDs, rutas internas o worktrees puede
repetir un encargo en un proyecto registrado sin reconstruir su configuración;
recibe cambios, pruebas y limitaciones y solo interviene cuando falta una decisión
real. Contaremos acciones, tiempo humano y abandonos además del consumo de IA.

## Validación de las próximas entregas

Reutilizar pruebas de servidor, navegador y empaquetado; añadir solo regresiones
que protejan el comportamiento cambiado. Conservar pruebas de permisos, cuota,
consumo desconocido, modificación de candidato, conflicto y pérdida de proceso.
Los tests de navegador deben cubrir también el arranque en frío, no solo cotas
rellenadas por un experto o historiales precargados.

GitHub Actions ya compila, prueba y ejecuta el circuito sin inferencia. Antes
de publicar cambios funcionales hay que comprobar el commit exacto y los jobs
correspondientes, no solo el badge. En el workflow actual, la deriva del inventario
E2E y del protocolo tiene `continue-on-error` pero sus IDs no entran en el gate
final; el inventario visible tampoco incluye el nuevo caso `team-workflows`.
Conviene corregir ese hueco pequeño de CI en una entrega separada, sin rebajar
checks. Esta observación no cambia el CI en la fase de auditoría.

No se propone ejecutar benchmarks reales en Actions ni guardar credenciales de
suscripción en GitHub. La CI valida código, entornos y protección; la futura
ejecución real autorizada sigue en el CLI oficial local.
