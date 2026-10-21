# Propuesta de orquestación adaptativa

21 de octubre de 2026. Primera etapa solicitada: diagnóstico del código y propuesta
concreta, sin modificar el runtime ni ejecutar tareas de IA. El catálogo se consultó
mediante el CLI oficial; esa consulta no es inferencia. Evidencia verificable en
[DIAGNOSTICO.json](DIAGNOSTICO.json). Los informes históricos permanecen intactos.

## Hallazgos por prioridad

1. **Alta: el presupuesto predice entrada, no el turno completo.**
   `server/src/execution/teamCoordinator.ts:478` usa una reserva fija inyectada o
   el máximo de entrada observado en la sesión. La primera estimación puede ser
   cero. No distingue modelo, esfuerzo, rol ni tamaño del trabajo, y no reserva
   de antemano el coste de los pasos imprescindibles que faltan. El piloto fijó
   20.000, pero el Tester comunicó 52.521 y quedaban 42.884. El límite observado
   detuvo la cola cuando el turno ya había comunicado 209.637 en conjunto.
   **No se puede presentar este mecanismo como un límite exacto de generación.**
   El límite inicial de equipo sigue en 30.000 (`teamPolicy.ts:10`), por debajo
   de varias ejecuciones históricas: no se elevará automáticamente para permitirlas.

2. **Alta: el Jefe no puede proponer asignaciones completas.**
   `teamCoordinator.ts:858` y `workflowPlan.ts:5` permiten papel, título, petición,
   dependencias e independencia. No admiten elección de modelo/esfuerzo, aceptación,
   propiedad de archivos, coste esperado ni tipo de revisión. La elección automática
   ocurre aparte en `teamPolicy.ts:65`; mejorar solo el prompt no resolvería esto.

3. **Alta: se confunden alcance y dificultad.**
   `taskAssessment.ts:45` considera complejo todo cambio en varios módulos.
   La factura conocida de dos archivos activa Arquitecto → Programador → Tester
   aunque riesgo e incertidumbre sean bajos y exista aceptación. Un cambio acotado
   con pruebas ya puede usar un único Programador; no partimos de cero. Pero ese
   caso se clasifica como normal y solo ofrece Sol, porque Luna queda reservada
   a explicaciones simples. `available` y un test marcado como aceptación tampoco
   demuestran por sí solos cobertura suficiente para retirar revisión.

4. **Media: la revisión no recibe el artefacto adecuado.**
   `taskContext.ts:42` pasa objetivo, archivos, decisiones y hasta 8.000 caracteres
   de respuestas anteriores. No construye diff ni evidencia de pruebas. El Tester
   puede repetir lecturas y comandos que la aplicación ya ejecuta en
   `teamCoordinator.ts:739`. Sus instrucciones actuales también piden ejecutar
   las pruebas (`roleProfiles.ts`). No hay duplicación oculta por un segundo modelo:
   las llamadas de los tres papeles están contabilizadas.

5. **Alta para paralelismo: varias carpetas no bastan.**
   `teamCoordinator.ts:508` impide simultaneidad del mismo papel y toda escritura
   concurrente. `executionLease.ts:15` solo admite ejecución exclusiva o dos lectores.
   `teamCoordinator.ts:663` rechaza dependencias procedentes de espacios distintos.
   AO ya crea espacios Git, pero faltan propiedad de archivos, capacidad de escritores
   aislados y una fase de integración y aceptación común. Cambiar solo `parallelSafe`
   debilitaría garantías y no implementaría esa integración.

6. **Media: la evidencia todavía no permite ordenar modelos por eficiencia.**
   Hay contadores por ejecución, controles de suscripción, pruebas locales y
   continuación explícita en AO. Falta un registro agregado fiable de estimaciones,
   defectos, reparaciones y resultados por combinación. Una caché mayor no equivale
   a cuota proporcionalmente menor. Los tres papeles del último piloto fueron
   sesiones nuevas, sin prueba real de continuación.

## Lo que dicen los números, sin inferencias adicionales

| Ejecución                 | Entrada sin caché | Entrada en caché | Salida |   Total |
| ------------------------- | ----------------: | ---------------: | -----: | ------: |
| Codex directo, referencia |            12.880 |           45.184 |  2.277 |  60.341 |
| Arquitecto                |            16.185 |           41.728 |  1.140 |  59.053 |
| Programador               |            40.888 |           54.912 |  2.263 |  98.063 |
| Tester                    |            15.233 |           34.944 |  2.344 |  52.521 |
| Oficina                   |            72.306 |          131.584 |  5.747 | 209.637 |

El 97,3 % del total de oficina es entrada, incluida caché. No es solo la longitud
del prompt inicial: incluye rondas de herramientas y contexto reenviado durante
la ejecución. Los recibos no identifican cuántos tokens pertenecen a cada archivo;
no podemos atribuir una cantidad exacta a cada lectura sin otra auditoría.
Los tiempos fueron 71,676 s y 194,190 s. Ambas implementaciones pasan 36 pruebas;
la oficina no fue aceptada por presupuesto y alcance estricto de bytes. El análisis
posterior atribuyó los cambios de archivos protegidos exclusivamente a LF/CRLF.

## Catálogo comprobado, candidatos todavía sin ahorro probado

La consulta del código fuente a `CodexExecutor.diagnose()` verificó ChatGPT Plus,
ausencia de consumo adicional según la política existente y estos modelos:

| Modelo anunciado | Razonamientos anunciados             |
| ---------------- | ------------------------------------ |
| gpt-6.1-sol      | low, medium, high, xhigh, max, ultra |
| gpt-6-astra      | low, medium, high, xhigh, max, ultra |
| gpt-6-sol        | low, medium, high, xhigh, max, ultra |
| gpt-6-luna       | low, medium, high, xhigh, max        |
| gpt-5.6-sol      | low, medium, high, xhigh, max, ultra |
| gpt-5.6-terra    | low, medium, high, xhigh, max, ultra |
| gpt-5.6-luna     | low, medium, high, xhigh, max        |

La presencia en el catálogo no prueba acceso efectivo a una tarea ni rendimiento.
Revalidar antes de cada ejecución. Propuesta inicial de candidatos: Luna 6/low para
trabajo sencillo; Sol 6.1/low como equilibrado; Sol 6.1/medium o high según evidencia
para trabajo complejo. Astra y esfuerzos superiores siguen como elección explícita,
sin asumir que mejoran el resultado. No ampliar automáticamente el conjunto a
modelos antiguos ni usar precios de API como estimación de cuota de suscripción.
Luna no se promocionará para código por haber respondido antes a una prueba mínima.

## Arquitectura propuesta para el Jefe

El Jefe será un controlador con dos vías, no una llamada obligatoria a un modelo:

1. **Evaluación local**: recoger petición, archivos identificados, cambios actuales,
   contratos, dependencias y comprobaciones registradas. Separar esfuerzo técnico,
   riesgo, incertidumbre, evidencia de aceptación y posibilidad de paralelismo.
   Indicar origen y confianza de cada dato. Una palabra clave o número de archivos
   aporta señales; no decide por sí solo. No ejecutar comandos propuestos por IA.
2. **Decisión**: vía directa cuando la evidencia basta; una planificación de IA
   acotada y de solo lectura para descomposición incierta. No consumir una llamada
   del Jefe únicamente para confirmar una regla local clara. Si faltan pruebas o
   presupuesto y la incertidumbre es importante, pedir revisión humana.
3. **Plan estructurado validado**: perfil de dificultad por tarea, justificación,
   archivos propios y compartidos, contratos, aceptación, comprobaciones, revisión
   none/focused/deep, dependencias, modelo/esfuerzo propuestos y estimación local.
   El modelo puede proponer, pero el código valida catálogo, límites, propiedad y
   condiciones mínimas de calidad; el plan no puede modificar permisos ni cuotas.
4. **Ejecución**: entregar solo el contexto de cada encargo y sus dependencias
   necesarias. Comprobar aceptación mediante herramientas locales antes de decidir
   si hace falta revisión adicional o si una reparación cabe en el presupuesto.
5. **Aprendizaje medido**: guardar resultados y errores de estimación por versión
   de política. Actualizar estadísticas locales sin reescribir instrucciones,
   aprender preferencias de textos del modelo ni promocionar políticas sin pruebas.

Reglas iniciales propuestas, que habrá que validar antes de activar:

| Situación acreditada                                                   | Circuito candidato                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Explicación clara                                                      | Un lector; sin Arquitecto ni Tester                                              |
| Cambio conocido de bajo riesgo, contrato claro y aceptación suficiente | Un Programador + comprobaciones locales                                          |
| Dos archivos con un contrato claro y sin riesgos nuevos                | Igual; dos módulos no obligan a tres agentes                                     |
| Cambio con riesgo residual fuera de las pruebas                        | Programador + comprobaciones + revisión focalizada independiente                 |
| Arquitectura incierta, seguridad, datos o concurrencia                 | Planificación/Arquitecto si hace falta + implementación + revisión profunda      |
| Pruebas insuficientes, alcance dudoso o presupuesto desconocido        | Investigación acotada o revisión humana; no rebajar calidad                      |
| Dos trabajos separables con contratos y archivos propios               | Candidato a dos Programadores aislados, solo tras implementar integración segura |

La dificultad puede variar por subtarea: una revisión acotada no hereda
automáticamente el máximo razonamiento del encargo completo. La decisión manual
del usuario conserva prioridad dentro de los controles de seguridad y presupuesto.

## Cambios priorizados y criterios de aceptación

| Orden | Cambios concretos                                                                                        | Archivos existentes / nuevos propuestos                                                                        | Verificación exigida                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | Registro histórico, estimación por turno y reserva de todo el plan imprescindible                        | `teamCoordinator.ts`, `types.ts`; nuevos `usageHistory.ts`, `budgetEstimator.ts`                               | No inicia si la estimación conservadora no cabe; cuentas concurrentes y reinicios conservan reservas; desconocidos pausan                      |
| P1    | Separar dificultad/riesgo y abrir vía de un Programador; plan del Jefe con propuestas de modelo/esfuerzo | `taskAssessment.ts`, `teamPolicy.ts`, `workflowPlan.ts`, `core/src/team.ts`, `teamRoutes.ts`                   | Casos representativos, planes inválidos rechazados atómicamente; el modelo no puede quitar revisión obligatoria ni elegir fuera del catálogo   |
| P2    | Artefactos de contexto, pruebas automáticas y revisión por diff                                          | `taskContext.ts`, `localChecks.ts`, `roleProfiles.ts`; nuevos `reviewPacket.ts`, `reviewPolicy.ts`             | Reviewer nuevo de solo lectura; diff base/candidato y resultados vinculados a hashes; no acepta pruebas de otra revisión                       |
| P3    | Matriz reproducible y evidencia para promocionar combinaciones modelo/esfuerzo                           | scripts de benchmark existentes; nuevo ejecutor de evaluación adaptativa                                       | Cinco variantes y circuito adaptativo; primero offline; incluye jefe, errores, reparaciones, integración y aceptación                          |
| P4    | Continuación del mismo trabajador cuando aporte valor                                                    | `orchestratorExecutor.ts`, `taskContext.ts`, `teamCoordinator.ts`                                              | Mismo proyecto/rol/permisos; deriva de contadores acumulados sin duplicar; consumo desconocido bloquea; reviewer nunca hereda sesión del autor |
| P5    | Dos Programadores en worktrees e integración acotada                                                     | `executionLease.ts`, `teamCoordinator.ts`, `workflowPlan.ts`, `orchestratorExecutor.ts`, `teamOfficeBridge.ts` | Archivos incompatibles y cambios compartidos se serializan; revisión conjunta del resultado integrado; ningún merge en proyecto original       |

P0–P2 reducen primero el coste evitable; P3 aporta la prueba para habilitar modelos
ligeros. P5 se mantiene inicialmente desactivado. No se promete ahorro por paralelizar:
reduce el camino de espera si las tareas son independientes, pero puede aumentar
tokens y trabajo de integración. Límite inicial propuesto: dos trabajadores.
La compatibilidad con personajes se resolverá conservando el comportamiento visual
actual; ninguna modificación gráfica se incluye en este plan.

### Presupuesto: qué sustituye a la reserva fija

- Historial deduplicado por ejecución/turno y versión: modelo/esfuerzo solicitado,
  confirmado si existe, rol, motor, tarea, contexto, duración, entrada, caché, salida,
  estado, defectos, reparaciones y aceptación. Registrar fallos y consumo desconocido;
  conservar intentos anteriores y muestras censuradas por cancelación/límite.
- Estimar **entrada + salida del turno**, sin restar la caché al presupuesto de
  tokens totales. Mantener aparte tiempo y cuota verificada; no existe aquí una
  conversión exacta de tokens a cuota. Agrupar por clase de trabajo, modelo/esfuerzo,
  motor y contexto; evitar mezclar una respuesta mínima con una implementación.
- Con pocas muestras: máximo relevante observado con margen conservador explícito
  (candidato inicial 1,5 veces), tamaño de contexto como señal y confianza baja.
  Con muestras suficientes: cuantil superior y margen calibrado mediante repetición
  cronológica. No afirmar un percentil fiable con una o dos observaciones.
- Sin muestras comparables ni límite superior defendible: revisión humana antes
  de inferencia. Un valor bajo inventado no sirve para habilitar modelos nuevos.
- Reservar atómicamente estimación del siguiente agente **y de los pasos obligatorios
  restantes**, incluidas planificación y reparaciones autorizadas. Liberar solo
  al cerrar con consumo conocido. La política no eleva presupuestos ni reanuda.
- El margen será una política versionada y probada, no una garantía del proveedor.
  Los eventos de consumo pueden llegar al finalizar; ni esta estimación ni el
  sandbox convierten el límite observado en un techo exacto de generación.

Ejemplo exclusivamente de calibración futura: el Tester medido en C usó 52.521;
1,5 veces serían 78.782 tokens, frente a los 42.884 que quedaban. Con ese historial
no se iniciaría un turno comparable. No es una predicción retrospectiva: antes de C
faltaba esa muestra y debe evaluarse la política usando solo el pasado disponible.

### Contexto y revisión

Construir un mapa local de archivos/contratos y evidencias asociado a la revisión
Git; reutilizarlo mientras sus hashes coincidan. Traspasos tipados con decisiones,
interfaces, archivos cambiados, cuestiones abiertas y referencias verificables;
no reenviar todo el historial ni truncar silenciosamente contratos críticos.
Un hash de contexto indica identidad, no demuestra un acierto de caché.

El reviewer recibirá principalmente diff, criterios de aceptación y resultados
locales, con base y candidato exactos. Añadir solo contratos vecinos necesarios.
Si el diff es grande, paginar o pasar a revisión profunda; no omitir cambios para
ahorrar. Hallazgos estructurados: archivo/línea, criterio vulnerado, evidencia
reproducible, gravedad e incertidumbre. Verificar referencias y comprobar que no
modificó archivos. Independiente significa sesión nueva de solo lectura; no exige
otro proveedor, pero usar el mismo modelo tampoco garantiza ausencia de sesgos.

Las pruebas registradas se ejecutan localmente sin pedir a un modelo que las
arranque. Reutilizar un resultado solo con mismos archivos, comandos, configuración
y entorno relevante; invalidarlo ante cambios. Una prueba pasada no demuestra
cobertura de requisitos no ejercitados. Para cambios delicados se conserva revisión
profunda aunque las comprobaciones mecánicas pasen.

Continuar una sesión del Programador puede evitar releer durante una reparación
del mismo encargo; también acumula contexto. Comparar sesión nueva frente a
continuada, contabilizando solo deltas de contadores. Nunca continuar por reutilizar
un personaje ni compartir la sesión del autor con su reviewer.

## Evaluación preparada como especificación; todavía sin pilotos

[EVALUACION.json](EVALUACION.json) define los cinco brazos solicitados y un sexto
circuito adaptativo para comprobar al Jefe. Es una especificación, no un ejecutor
nuevo ya implementado. Ningún brazo queda autorizado para inferencia.

1. Codex individual: referencia con modelo/esfuerzo explícitos y aceptación externa.
2. Programador ligero + pruebas locales: candidato Luna/low.
3. Programador equilibrado + pruebas locales: candidato Sol/low.
4. Revisión selectiva: candidato equilibrado con revisión focalizada solo si una
   regla de riesgo documentada lo exige; medir también los casos donde se omite.
5. Equipo completo: Jefe de IA + Arquitecto + Programador + Tester como control;
   incluir todo su consumo, sin imponerlo al circuito adaptativo.
6. Oficina adaptativa: reglas locales primero, Jefe IA cuando aporte valor y plan
   validado; cuenta todas las etapas y posibles escalados autorizados.

Usar contrato, estado inicial, permisos, herramientas y pruebas iguales; permitir
modelos distintos como variable explícita. Separar prueba del producto completo
(CLI directo frente a oficina AO) de experimentos que cambian solo modelo o
razonamiento en el mismo motor. No atribuir al modelo diferencias del motor.
Los resultados históricos siguen como referencias; no reemplazan repeticiones
contemporáneas y no se ejecuta de nuevo el directo sin necesidad/autorización.

Antes de IA: validar oráculos, reproducir decisiones con casos ciegos, planes
contradictorios, límites y reinicios; simular los cinco brazos y el adaptativo con
el coordinador real; probar las rutas largas y CRLF; sembrar defectos que las
pruebas públicas no capturen para comprobar el valor del reviewer. Cubrir contrato
claro en varios archivos, ausencia de pruebas, señales engañosas, seguridad,
concurrencia y trabajos con propiedad solapada. No cambiar los casos históricos
para declarar éxito: el nuevo comportamiento se evalúa en un corpus versionado.

Después, solo con autorización de límites: tareas fáciles/medias/difíciles y casos
de riesgo con oráculos independientes, orden alternado, varias repeticiones si
caben, sesiones y caché registradas. Reportar muestras individuales, dispersión,
fallos, defectos escapados, correcciones, tiempos completos y tokens. Igualar los
presupuestos totales entre estrategias; una revisión obligatoria que no cabe
produce pausa, nunca éxito ni retirada de la revisión. Los ahorros se comparan
únicamente entre resultados aceptados de calidad equivalente. Un caso no prueba
la máxima calidad posible ni eficiencia universal.

## Estado al entregar esta propuesta

- Implementado en esta etapa: documentación, evidencia del código, consulta oficial
  de catálogo sin inferencia, desglose histórico y especificación de comparación.
- Comprobado: cinco escenarios de clasificación actual y 123 pruebas existentes
  offline de clasificación, planes, coordinación y suscripción. No son pruebas
  del algoritmo adaptativo nuevo, que todavía no se ha implementado.
- Pendiente: P0–P5, nuevas simulaciones y aceptación local de esas implementaciones.
  Toda prueba real requiere una autorización posterior con límites explícitos.
- Sin cambios al runtime, configuración del motor, diseño, personajes o animaciones;
  AO opcional, Claude desactivado y Antigravity desconectado. Sin APIs de pago,
  créditos, cambios de autenticación ni modificaciones a resultados históricos.
