# Objetivos actuales de la oficina

Acordados con el usuario el 25 de octubre de 2026. Esta hoja de ruta establece
las nuevas prioridades; el objetivo anterior del ecosistema permanece cerrado
con sus limitaciones aceptadas. Registrar estos objetivos no acredita su ejecución.

## Prioridades y aceptación

| Prioridad | Trabajo                                                             | Por qué                                   | Evidencia necesaria para cerrar                                                                                                                                                                          | Estado                          |
| --------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| P0        | Resolver el fallo del runtime en CI                                 | Validar la última gran integración        | Identificar la ejecución y causa del fallo, corregirlo y acreditar una ejecución de CI satisfactoria de la revisión corregida. Un pase local no sustituye CI.                                            | Completado · CI 2f816c0         |
| P1        | Añadir un presupuesto de autonomía comprensible                     | Proteger la cuota frente a ciclos largos  | Mostrar consumo conocido, incertidumbre, progreso y motivo de pausa; comprobar continuación y recuperación sin borrar consumo ni imponer cortes arbitrarios de duración.                                 | Completado · prueba real        |
| P1        | Completar una ficha final de evidencias junto al resumen del Jefe   | Hacer la entrega más fiable y verificable | Una entrega identifica cambios, pruebas y resultados, artefactos, revisión y limitaciones; persiste al reabrir el chat y distingue simulación de comprobación real.                                      | Completado · prueba real        |
| P1        | Probar una tarea completa de programación con la interfaz real      | Validar el producto, no solo el backend   | Ejecutar una petición desde Conversaciones hasta cambios, pruebas, revisión y resumen final; conservar evidencia de la interfaz y verificar historial tras reabrir.                                      | Completado · prueba real        |
| P2        | Benchmark controlado de Codex individual frente al equipo iterativo | Medir calidad, tiempo y tokens            | Comparar tareas y condiciones equivalentes, con criterios de calidad previos y registro de tiempo, tokens, coordinación, revisión e integración; declarar consumos desconocidos y límites de la muestra. | Completado · pareja real medida |
| P2        | Simplificar los módulos más extensos gradualmente                   | Reducir coste de mantenimiento            | Elegir módulos por evidencia de complejidad, extraer responsabilidades en cambios pequeños y verificar compatibilidad con pruebas pertinentes.                                                           | Completado · dos extracciones   |
| P3        | Perfeccionar la representación pixelada de trabajo y entregas       | Diferenciar el producto visualmente       | Propuesta aprobada por el director creativo, implementación vinculada a estados reales y comprobación visual de trabajo, pausa y entrega.                                                                | Completado · simulación visual  |

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

## Estado vigente

Benchmark P2 completado sobre `500463e`: Codex individual, 50.136 ms y 165.398
tokens; oficina, 171.255 ms y 374.467 tokens, con revisión del Tester de 48.096 ms
y continuidad nativa del Jefe. Los seis turnos conservaron modelo y razonamiento,
recibos completos y alcance permitido. Ambos métodos superaron 32/36 pruebas
externas y las pruebas públicas: medición completa, soluciones no aceptadas por
las cuatro discrepancias de clases de error ya documentadas en el contrato v1.
No se afirma superioridad general. La [ficha pública](evidence/iterative-benchmark-2026-10-26.json)
y el [informe](BENCHMARK_ITERATIVO.md) conservan métricas, controles y limitaciones.
La hoja de ruta tiene sus entregas implementadas y acreditadas con las limitaciones
de cada prueba; los párrafos siguientes preservan el historial de diagnóstico.
La corrección adicional de saturación está publicada en `500463e`, validada
localmente; su CI 40364720876 sigue pendiente de finalizar.

Intento anterior: ya había cuota y se ejecutó la pareja real sobre `64c040c`.
Individual terminó en 65.784 ms con 106.433 tokens conocidos; la oficina alcanzó
480.652 ms y se detuvo mientras esperaba al Tester, cuyo recibo no tiene contadores
finales. Conserva al menos 194.756 tokens conocidos, sin reconstruir el resto.
Ambos métodos pasaron 32/36 comprobaciones externas, las pruebas públicas y el
alcance de archivos permitido. La comparación queda incompleta, sin cocientes
de eficiencia: falta diagnosticar y acreditar el cierre real de la revisión.
La cuota ya no es el motivo vigente. El [informe](BENCHMARK_ITERATIVO.md) recoge
la limitación del contrato y el intento fallido; no se amplió ni repitió el bloque.
La oficina habitual sigue sin tareas activas.

Investigación posterior: el CLI oficial recibió HTTP 429 al iniciar el Tester y
programó un reintento tras unos 407 segundos. El temporizador de evaluación lo
interrumpió antes de ese reintento; no hubo una revisión de seis minutos. La
oficina no presenta los avisos reintentables y descarta stderr, por lo que no
mostró esa espera. La causa inmediata está identificada; falta corregir esa
presentación y acreditar una revisión real completa. No se conoce qué límite
interno del servicio provocó el 429 ni se reconstruye el consumo desconocido.

Corrección posterior implementada: [esperas y continuación por saturación](SATURACION_MODELOS.md).
La oficina muestra las categorías de espera que comunica el CLI y permite una
continuación al modelo inmediatamente inferior adecuado cuando hay confirmación
de saturación, con cuota nuevamente comprobada y recibos conservados. Un 429
genérico no activa esa continuación. Pasan la batería local de 1.253 pruebas de
servidor (dos omitidas), 106 de interfaz y ocho contratos; el ensayo simulado del
benchmark completa los seis turnos y sus comprobaciones. Queda por registrar el
nuevo intento real; la prueba de saturación y sustitución es simulada.

Actualización del 26 de octubre: integración de Antigravity y segundo bloque de
simplificación publicados en `0ff6a21c29c294d785cb58f6b687377c7de83a7a`.
La [validación 40327075378](https://github.com/rubengp02/agents-sims/actions/runs/40327075378)
terminó con éxito: comprobaciones generales, runtime sin inferencia, paquete
Node 20, nueve grupos E2E en Linux/Windows/macOS y Required Checks. Los despliegues
se omitieron por la configuración del workflow; no se acredita un despliegue.
La instancia local se actualizó estando inactiva y conserva ocho proyectos,
diez conversaciones, 135 mensajes con las mismas huellas de contenido y diez
referencias de imágenes. Se verificaron cero tareas activas tras reiniciar.

Antecedente, sustituido por la comprobación real indicada arriba: el intento
anterior acreditó preparación y 36 comprobaciones de referencia,
pero se bloqueó por cuota antes de iniciar inferencias: cero turnos, sin nuevos
recibos de modelo ni resultados comparativos. La lectura oficial posterior indica
82% en la ventana corta y 13% semanal; el protocolo exige menos del 80% en ambas
antes de cada método. El reinicio comunicado es el 26 de octubre a las 16:38
(Europe/Madrid). La autorización del usuario para este bloque ya está concedida;
falta cuota disponible, no otra confirmación. No se elevó el umbral ni se utilizó
un reinicio de cortesía o facturación adicional.

Segundo bloque de simplificación completado: la política por proveedor se extrae
de `TeamCoordinator`, un módulo de más de cuatro mil líneas, a
`providerModelPolicy.ts`. El coordinador conserva diagnóstico, cancelación y
despacho; el módulo puro decide sobre el catálogo ya verificado. Se mantienen
la elección manual, el criterio por riesgo, la revisión independiente y las
explicaciones existentes. Seis regresiones cubren objetivos frente a instrucciones
internas, riesgo, Tester, catálogos vacíos y compatibilidad con Codex; pasan junto
con las 46 pruebas relacionadas de coordinación y Antigravity. No constituye una
reescritura ni una promesa de haber simplificado todos los módulos.

P2: [benchmark preparado y primer intento real documentado](BENCHMARK_ITERATIVO.md);
la medición completa queda pendiente de cuota y de recoger todos los recibos.
El verificador ya espera al cierre del coordinador sin consultar ni escribir
estados periódicamente. Pasan 70 regresiones de coordinación/conversaciones y
el ensayo simulado completo; esa comprobación sin inferencia queda incluida en CI.
La [validación de 203f28e](https://github.com/rubengp02/agents-sims/actions/runs/40212920863)
terminó con éxito, incluida la extracción de configuración. La
[validación de 60bb528](https://github.com/rubengp02/agents-sims/actions/runs/40213879047)
terminó con éxito y contiene la nueva espera de recibos y el ensayo simulado en CI.
El siguiente bloque real necesita una cuota actual inferior al margen de inicio;
la lectura vigente se indica arriba. La elección creativa de P3 quedó resuelta:
Señales discretas.
La configuración de permisos y herramientas se separó del ejecutor App Server,
un módulo de unas 1.900 líneas; conserva su exportación anterior y pasan las
63 pruebas de protocolo y permisos, tipos y lint. Es un primer paso de simplificación.
P3: [Señales discretas aprobada e implementada](PROPUESTA_ESTADOS_OFICINA.md),
comprobada en la interfaz con personajes existentes y estados simulados sobre
el servidor real, en escritorio y móvil. Instancia activa actualizada desde
una copia limpia de ae2a69c, sin incluir cambios ajenos; diez conversaciones y
135 mensajes conservados con la misma huella y sin reanudar encargos.

P1 completado y actualizado localmente. El recorrido real desde Conversaciones
terminó con un cambio acotado, pruebas independientes aprobadas, revisión del
Tester, resumen del Jefe y ficha persistente; los cinco turnos y sus 310.350 tokens
se conservaron tras reabrir. La actualización mantuvo diez conversaciones y
135 mensajes: solo añadió metadatos de presupuesto, con todos los campos originales
intactos. Se corrigió un rechazo del adaptador a ediciones ya autorizadas.
La [verificación de P1](VERIFICACION_P1.md) distingue el caso satisfactorio,
los intentos de diagnóstico, la simulación y las limitaciones. Las notas siguientes
conservan el proceso de validación anterior, no sustituyen este estado vigente.

P0 completado: la [ejecución 40201367786](https://github.com/rubengp02/agents-sims/actions/runs/40201367786)
de `2f816c0459b571db748e580e5523ceb3e3a0c5be` terminó con `success`. Pasaron
los nueve jobs E2E de Linux, Windows y macOS, el runtime, el paquete Node 20,
las comprobaciones generales y Required Checks. El despliegue quedó omitido por
la configuración de ese workflow; no se acredita un despliegue.

Primer P1 implementado y validado localmente, sin actualizar la oficina activa:
registro de intentos por objetivo (Jefe y empleados), cuota compartida y margen
del 10% visibles en un detalle plegable, conservación de recibos incompletos y de
sus contadores parciales, y recuperación sin ejecutar trabajo al abrir el historial.
No se añade un corte por minutos. La lectura de cuota reutiliza las comprobaciones
oficiales previas a cada ejecución; el margen no limita por sí solo el consumo de
una ejecución ya iniciada. Los registros antiguos sin desglose siguen identificados
como desconocidos, no se reconstruyen como cero.

Validación local de P1: 1.125 pruebas de servidor aprobadas y dos omitidas,
99 pruebas de interfaz y recorrido de conversación en navegador con ejecutor
simulado (envío, confirmaciones, presupuesto, historial y reinicios). El frontend
de esa comprobación se construyó en `.local-office/`, sin reemplazar los archivos
de la oficina activa. La inspección visual detectó que el detalle desplegado ocultaba
Enviar en escritorio; se separó del cuadro de escritura y se añadieron comprobaciones
de visibilidad de Mensaje y Enviar en escritorio y móvil. El recorrido completo volvió
a pasar, y ambas capturas se revisaron visualmente. Tipos y lint pasan (solo el aviso
preexistente de dependencia `editor` en App.tsx). Pendiente prueba con Codex real
junto al resto de P1. Las notas de P0 que
siguen conservan el diagnóstico histórico; su cierre lo acredita la ejecución anterior.

Revisión final de P1: el presupuesto desplegado se comprobó en capturas de
escritorio y móvil, con Mensaje y Enviar dentro de la pantalla y sin desbordamiento
horizontal. Se cubre también el cierre entre el evento final del ejecutor y la
persistencia del recibo: al recuperar se pausa el encargo, se conservan los tokens
parciales y no se restaura aceptación sin recibo. Pasaron 60 pruebas de consumo y
conversaciones después de ese ajuste. Sigue pendiente la validación con Codex real
junto a la ficha final de evidencias y la tarea de programación del resto de P1.

Segundo P1 implementado y comprobado localmente: ficha de evidencias generada por
el servidor junto al resumen final del Jefe. Conserva revisión del objetivo,
archivos comparados y huellas, comprobaciones locales con salida y duración,
revisión vigente del Tester, referencias a artefactos y limitaciones. No convierte
comandos citados por el modelo en pruebas registradas ni atribuye autoría a una
comparación. Se identifica ejecución oficial, simulada o de procedencia no acreditada;
los adaptadores con lanzamiento o descubrimiento sustituidos no acreditan CLI oficial.
Las respuestas directas indican que no hubo Tester. Los historiales antiguos siguen
siendo legibles sin inventarles una ficha. La aceptación humana y publicación no se
infieren del cierre del modelo.

Pruebas de esta entrega: 169 de servidor relacionadas con ejecutores, cola y
conversaciones; 101 de interfaz; tipos y lint aprobados (aviso preexistente de
App.tsx). El recorrido en navegador real con ejecutor simulado muestra la ficha
y la conserva tras un reinicio sin despachar trabajo. Captura revisada en la vista
previa aislada. Se rechazan revisiones de otro objetivo, antiguas o de archivos
distintos; no se permite acreditar cambios mediante una respuesta directa.
Pendientes: comprobar esta revisión en CI y ejecutar el recorrido completo de
programación con Codex real. No se ha actualizado la instancia activa.

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
