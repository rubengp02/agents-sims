# Objetivos actuales de la oficina

Acordados con el usuario el 25 de octubre de 2026. Esta hoja de ruta establece
las nuevas prioridades; el objetivo anterior del ecosistema permanece cerrado
con sus limitaciones aceptadas. Registrar estos objetivos no acredita su ejecución.

## Prioridades y aceptación

| Prioridad | Trabajo                                                             | Por qué                                   | Evidencia necesaria para cerrar                                                                                                                                                                          | Estado                      |
| --------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| P0        | Resolver el fallo del runtime en CI                                 | Validar la última gran integración        | Identificar la ejecución y causa del fallo, corregirlo y acreditar una ejecución de CI satisfactoria de la revisión corregida. Un pase local no sustituye CI.                                            | En diagnóstico y corrección |
| P1        | Añadir un presupuesto de autonomía comprensible                     | Proteger la cuota frente a ciclos largos  | Mostrar consumo conocido, incertidumbre, progreso y motivo de pausa; comprobar continuación y recuperación sin borrar consumo ni imponer cortes arbitrarios de duración.                                 | Pendiente                   |
| P1        | Completar una ficha final de evidencias junto al resumen del Jefe   | Hacer la entrega más fiable y verificable | Una entrega identifica cambios, pruebas y resultados, artefactos, revisión y limitaciones; persiste al reabrir el chat y distingue simulación de comprobación real.                                      | Pendiente                   |
| P1        | Probar una tarea completa de programación con la interfaz real      | Validar el producto, no solo el backend   | Ejecutar una petición desde Conversaciones hasta cambios, pruebas, revisión y resumen final; conservar evidencia de la interfaz y verificar historial tras reabrir.                                      | Pendiente                   |
| P2        | Benchmark controlado de Codex individual frente al equipo iterativo | Medir calidad, tiempo y tokens            | Comparar tareas y condiciones equivalentes, con criterios de calidad previos y registro de tiempo, tokens, coordinación, revisión e integración; declarar consumos desconocidos y límites de la muestra. | Pendiente                   |
| P2        | Simplificar los módulos más extensos gradualmente                   | Reducir coste de mantenimiento            | Elegir módulos por evidencia de complejidad, extraer responsabilidades en cambios pequeños y verificar compatibilidad con pruebas pertinentes.                                                           | Pendiente                   |
| P3        | Perfeccionar la representación pixelada de trabajo y entregas       | Diferenciar el producto visualmente       | Propuesta aprobada por el director creativo, implementación vinculada a estados reales y comprobación visual de trabajo, pausa y entrega.                                                                | Pendiente de propuesta      |

## Orden de trabajo y reglas

1. Resolver P0 antes de ampliar capacidades. Recoger el fallo real de CI antes
   de atribuir una causa o modificar el runtime.
2. Abordar P1 en el orden de la tabla; usar la tarea real para comprobar también
   el presupuesto y la ficha final de evidencias.
3. Preparar el benchmark con condiciones y consumo acotados; no iniciar pruebas
   de IA ilimitadas ni recurrir a servicios de pago alternativos.
4. Simplificar gradualmente, evitando una reescritura general.
5. Presentar la propuesta visual P3 antes de cambios importantes de diseño.

El presupuesto de autonomía debe ser entendible y permitir tareas largas. Su
diseño no fija ahora un número de minutos, tokens o iteraciones: primero se revisan
los controles existentes y la evidencia de consumo. Se conservan la cuota incluida,
la parada del usuario, las pausas por incertidumbre y las aprobaciones externas.

Cada entrega registrará la revisión comprobada, qué se implementó, qué se probó
localmente o con simulaciones, qué se validó realmente y qué queda pendiente.
Los detalles privados y las transcripciones permanecen fuera de Git.

## Primer trabajo

P0 en curso. En la [ejecución de la última integración](https://github.com/rubengp02/agents-sims/actions/runs/40196864694),
el job Agent runtime falla en la batería de aplicación sin identificar el archivo;
su diagnóstico adicional muestra pruebas de navegador que intentan pulsar Settings
bajo Conversaciones. Las comprobaciones generales y el paquete Node 20 sí pasaron.

Correcciones locales: navegación visible para abrir Settings; pruebas de sesiones
externas adaptadas a su separación de los empleados; estado de trabajo basado
también en herramientas comunicadas por hooks, no solo en entradas JSONL; plazo
de 30 segundos para una prueba con varios worktrees Git (sin cambiar presupuestos
de ejecución); diagnóstico público de archivos Vitest fallidos sin publicar logs.

Evidencia local: 96 pruebas de interfaz; 19 de integración Git; cuatro de presencia;
dos del filtro de diagnósticos. La batería de navegador detectó el fallo real de
presencia: once recorridos pasaron y uno falló; tras corregirlo, ese recorrido
también pasó. Pendiente comprobar el conjunto corregido en CI y confirmar la causa
del fallo inicial de aplicación. No se declara cerrado P0.

La [validación de bb6ac31](https://github.com/rubengp02/agents-sims/actions/runs/40198697740)
confirma los doce recorridos de navegador en Linux y las comprobaciones generales.
El diagnóstico identifica el bloqueo restante en `toolRuntime.test.ts`; las
comprobaciones nativas de AO también pasan en el diagnóstico adicional. Se ha
corregido una dependencia de plataforma: el navegador exigía Edge en Linux aunque
CI instala Chromium. Se conserva Edge en Windows y se usa Chromium administrado
en otros sistemas. Las nueve pruebas del runtime pasan localmente; la validación
Linux de este último cambio sigue pendiente. No se atribuye todavía todo el fallo
a esta dependencia ni se ocultan las incidencias E2E de VS Code observadas en CI.

El fallo de carga de VS Code se reprodujo localmente al importar el bundle real:
`createRequire` recibía una ruta indefinida. La ruta HTTP importaba el error de
validación de imágenes desde el almacén y arrastraba Sharp al bundle CommonJS de
la extensión; Sharp usa `import.meta.url`. Se separó la clase de error sin cargar
procesamiento nativo en esa ruta y se conserva su exportación anterior para
compatibilidad. El nuevo contrato carga el bundle construido en un proceso limpio,
con solo la API de VS Code sustituida, y comprueba sus exportaciones. Pasan ocho
contratos de paquete y 59 pruebas de adjuntos/conversaciones. La aceptación real en
VS Code sigue pendiente. El job general de CI instala explícitamente el Chromium
administrado que necesitan las pruebas de navegador del servidor.

El [job Agent runtime de 520edd4](https://github.com/rubengp02/agents-sims/actions/runs/40199468861/job/121187637020)
ha terminado correctamente en Linux: paquete, aplicación, políticas, supervisión,
AO nativo, matriz y doce recorridos standalone; informe `VALIDACION-4de9fb62.json`,
`passed: true`, cero inferencias. El fallo del runtime queda corregido en esa
revisión; P0 permanece abierto hasta validar también los demás jobs de la gran
integración con las correcciones de carga de VS Code y de instalación de Chromium.

En la [validación de 515f30d](https://github.com/rubengp02/agents-sims/actions/runs/40200044360),
el nuevo contrato de carga detectó un error en el orden del job Node 20: se
ejecutaba antes de construir `dist/extension.js`. Se reordena ese job para verificar
primero el paquete construido e instalado y ejecutar después sus contratos. Las
pruebas E2E de esa revisión siguen siendo evidencia útil de la corrección de carga;
no se declara todavía una ejecución global satisfactoria.

La revisión 515f30d confirma los jobs general y runtime, las partes 1 y 2 de
Linux y la parte 1 de Windows. La parte 3 de Linux y Windows solo falla en la
prueba conjunta de servidores: todavía esperaba que la sesión externa del
navegador fuera un empleado. Se adapta esa prueba manteniendo verificaciones de
aislamiento por proyecto en el servidor, observación visible y ausencia de avatares
externos. El recorrido revisado pasa en VS Code y navegador reales en Windows,
con proveedores simulados, sin inferencia. También pasa el recorrido de todos los
nombres de herramienta en VS Code. Los perfiles, servidores y proyectos son temporales.

La prueba conjunta encontró que la lista de sesiones mostraba una carpeta de
transcripciones codificada, con fragmentos de ruta privada. La adopción de hooks
ahora conserva el nombre real de la carpeta de trabajo, y la presencia utiliza
esa etiqueta para sesiones observadas. Se mantienen las identidades y las rutas
internas para el seguimiento. Pasan 36 pruebas de presencia, adopción y descartes
y ocho contratos de paquete. Pendiente comprobación completa de CI de esta revisión.
