# Revisión previa: oficina con ejecuciones solo mediante suscripciones

Fecha: 20 de octubre de 2026.

Actualización posterior: ya se ha implementado el primer ejecutor Codex y sus controles locales. Este documento conserva la revisión previa; el estado de esa implementación está en [EJECUCION_OFICIAL.md](EJECUCION_OFICIAL.md). El Jefe y su interfaz siguen pendientes.

## Alcance y estado honesto

Esta revisión responde al requisito de explicar primero los cambios necesarios. No implementa todavía el ejecutor multiagente, no cambia la apariencia ni las animaciones, no configura claves, no actualiza instalaciones ni modifica sesiones de autenticación. Las comprobaciones al proveedor consultan únicamente metadatos con el CLI oficial; no crean conversaciones ni envían tareas a modelos.

La aplicación personal tendrá una política obligatoria de **solo suscripción**. No basta con seleccionar esta opción en la pantalla: el servidor debe impedir otras vías. No se añadirá un adaptador de inferencia mediante API de pago en esta primera versión.

## Lo comprobado en este ordenador

- La oficina responde en su dirección local habitual y el lanzador informa que está en marcha.
- `office.config.json` habilita únicamente el observador Codex y conserva `watchAllSessions: true`.
- El comando `codex` encontrado primero sigue siendo 0.154.0. La instalación local 0.163.0-alpha.10.2 anuncia siete modelos, incluidos GPT-6.1 Sol y GPT-6 Luna. El ejecutor debe resolver una instalación concreta y validar su versión; no confiar en el primer ejecutable del PATH.
- La consulta al CLI reciente con restricción de inicio de sesión ChatGPT devolvió `account.type: chatgpt`, `planType: plus` y `requiresOpenaiAuth: true`.
- La consulta de límites devolvió ventanas de cuota no agotadas y, en la misma observación, `credits.hasCredits: false` y `credits.unlimited: false`. Son datos de ese instante, no una garantía para ejecuciones posteriores ni un bloqueo del gasto ya implementado.
- No están definidas en el proceso de comprobación las variables habituales de clave API de OpenAI, Anthropic o Google, ni los cambios a Bedrock/Vertex/Foundry examinados. Solo se comprobó su presencia: no se imprimieron ni copiaron valores. Esto no certifica todas las configuraciones de otros procesos, proyectos o cuentas.
- `claude` no se encuentra en el PATH de este proceso. Claude permanece desactivado; no se ha instalado ni autenticado.
- Solo se ha consultado el perfil actual de Codex. No se han unido las dos suscripciones del usuario ni cambiado de cuenta.
- No se han leído `auth.json`, almacenes de credenciales, cookies ni tokens. La autenticación la gestiona el CLI oficial. No se ha iniciado inferencia para verificar acceso a modelos.

## Hallazgos por prioridad

| Prioridad                          | Hallazgo y evidencia                                                                                                                                                                                                                        | Cambio necesario                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crítica para autorizar ejecuciones | No existe una comprobación de suscripción y gasto antes de arrancar agentes. `server/src/cli.ts` instala observadores; `core/src/provider.ts` describe hooks y comandos, no un control de facturación.                                      | Añadir una barrera de ejecución en el servidor: sesión admitida, proveedor oficial, cuota comprobable y ausencia verificable de consumo adicional. Cualquier dato requerido desconocido bloquea el inicio. |
| Alta                               | Codex es actualmente un observador. `server/src/providers/hook/codex/codex.ts` inicia `CodexTailer`, que sigue transcripciones y emite eventos. No controla modelos, esfuerzo ni tareas.                                                    | Crear un ejecutor separado mediante el proceso oficial `codex app-server` y su entrada/salida local; no mediante un SDK de inferencia ni enviando credenciales a endpoints desde nuestra aplicación.       |
| Alta                               | El modo standalone no tiene un Jefe ejecutor. `server/src/clientMessageHandler.ts` maneja oficina, ajustes y seguimiento; en `adapters/vscode/agentManager.ts` el lanzamiento existente está vinculado a Claude y a un terminal de VS Code. | Añadir servicio local de tareas, asignaciones y procesos que funcione sin VS Code, conservando la extensión y el seguimiento existentes.                                                                   |
| Alta antes de añadir ejecución     | `server/src/httpServer.ts` omite autenticación para el WebSocket standalone y no aplica ahí una comprobación de Origin. Vincular a localhost no autentica el origen de una página web.                                                      | Proteger los nuevos controles de ejecución y configuración mediante sesión local, validación de origen y mensajes tipados. No exponer un endpoint que acepte comandos shell arbitrarios.                   |
| Alta                               | No hay pausa recuperable por cuota ni control de reintentos/escalados. Retirar un personaje (`closeAgent`) descarta su representación; no interrumpe una ejecución externa.                                                                 | Separar cerrar representación, cancelar tarea, esperar permisos y pausar por cuota; guardar progreso y referencias a sesiones para reanudar con nuevas comprobaciones.                                     |
| Media                              | El catálogo y las decisiones visuales anteriores eran simulaciones; el catálogo cambia según el ejecutable consultado.                                                                                                                      | Descubrimiento por runtime y perfil, selección restringida en servidor y etiquetas que distingan modelo solicitado, aceptado y confirmado.                                                                 |
| Media                              | Un medidor de contexto (`server/src/contextUsage.ts`) no equivale a consumo acumulado ni a cuota de suscripción restante.                                                                                                                   | Mostrar cada medida por separado; no convertir tokens a euros ni inventar cuántas tareas quedan.                                                                                                           |

El riesgo de estas carencias corresponde a **añadir ejecución real sin resolverlas**. No significa que el observador actual esté haciendo llamadas API o que haya generado un gasto detectado.

## Arquitectura propuesta

Conservar el motor de la oficina y añadir estas responsabilidades, con sus pruebas:

1. **Registro de herramientas locales:** ubicación y versión verificadas de Codex y Claude, disponibilidad y capacidades. No instalar o actualizar automáticamente ni reutilizar una ruta versionada cuando haya desaparecido.
2. **Control de suscripción:** comprobaciones de autenticación, proveedor, perfil, cuota, consumo adicional y cambios de estado. La decisión es `permitir`, `pausa_por_cuota` o `bloqueado_no_verificable`, con razón concreta. El Jefe no puede anularla.
3. **Política y catálogo:** lista reducida por tarea, esfuerzo nativo, límites, modo Auto predeterminado y elecciones manuales/mixtas. El usuario puede cambiar modelo o esfuerzo, pero ninguna elección manual habilita una API de pago ni desactiva las reglas obligatorias de suscripción.
4. **Jefe y cola de tareas:** clasificación, descomposición cuando aporte valor, dependencias, resultados, permisos, máximo de concurrencia y presupuesto de contexto/turnos. Trabajos sobre los mismos archivos se serializan o se aíslan con una estrategia que respete la prohibición de cambios de rama sin instrucción.
5. **Ejecutores oficiales:** procesos de Codex y, cuando exista y se active, Claude Code. Argumentos estructurados y texto por entrada estándar; sin construir órdenes shell a partir de la petición. Rechazar sobreescrituras de proveedor o autenticación que no puedan comprobarse. No heredar claves ni configuraciones de terceros que abran una vía de pago.
6. **Puente a la oficina:** traducir eventos de ejecuciones administradas al modelo actual de agentes y personajes. Conservar el seguimiento de sesiones externas, diferenciándolo de ejecuciones que esta aplicación puede controlar y verificar. Deduplicar por identidad de sesión para no crear dos personajes por el mismo agente.

Posibles módulos nuevos: `server/src/orchestration/` para tareas, política y controles, y `server/src/executors/` para los adaptadores. Son ubicaciones propuestas, no módulos ya existentes. No se sustituirá el contrato actual de observación por uno de ejecución: son responsabilidades distintas.

## Codex: sesión de ChatGPT, sin API de pago

Usar el ejecutable oficial reciente a través de `codex app-server` por stdin/stdout. Sigue siendo Codex CLI gestionando su propia sesión; no es una llamada de inferencia a una API facturable desde nuestra aplicación.

Antes de una tarea:

- Comprobar la cuenta con `account/read` sin solicitar tokens y exigir el modo ChatGPT admitido; rechazar API key, Bedrock, tokens externos, identidades programáticas y proveedores personalizados en esta versión personal.
- Aplicar la restricción oficial de método ChatGPT al proceso y validar que el proveedor y la configuración efectivos coinciden. No modificar el almacén de credenciales ni pasar por flujos de login que extraigan tokens. Una incompatibilidad detectada debe bloquearse antes de intentar lanzar un proceso que pudiera cerrar una sesión existente.
- Leer `model/list` y los esfuerzos que anuncia ese runtime. La lista no certifica acceso de inferencia a todos los modelos. Una denegación del proveedor deja un fallo o pausa honestos; no activa una sustitución de pago.
- Leer `account/rateLimits/read`, con todos los buckets relevantes, y comprobar los límites de la suscripción y el estado de créditos/consumo adicional. Datos ausentes o una tarifa de workspace basada en gasto requieren bloquear el modo estricto hasta poder verificar una vía válida.
- No comprar, recargar, consumir resets o activar créditos. La aplicación no llamará a operaciones de consumo de créditos, notificaciones para comprar saldo ni cambios de plan. Si el CLI o la cuenta pueden recurrir a saldo extra y no se puede impedir y verificar, la tarea no se inicia.
- Vigilar cambios de cuenta y cuota durante el trabajo; pausar nuevas delegaciones y solicitar interrupción cuando corresponda. Antes de reanudar, repetir la comprobación.

La cuota se comparte con el uso de Codex fuera de esta aplicación. La aplicación puede limitar su propia cola, pero no reservar una cantidad exacta de cuota frente a otros clientes. No se puede prometer un corte instantáneo o un número exacto de tokens: el proveedor puede permitir terminar un turno ya iniciado, y la cancelación no es retroactiva. Por eso la ausencia de vías de consumo adicional debe comprobarse además de vigilar la cuota.

No se usarán los precios API para decidir cuántos mensajes permite la suscripción. La referencia principal serán la documentación de consumo incluido, los límites comunicados y las mediciones de tareas propias. Standard será el modo inicial; Fast y Ultrafast quedarán excluidos de la política automática de ahorro.

Fuentes: [autenticación de Codex](https://learn.chatgpt.com/docs/auth), [cuenta, límites y turnos en App Server](https://learn.chatgpt.com/docs/app-server), [consumo y límites de Codex](https://learn.chatgpt.com/docs/pricing).

## Claude: opcional y desactivado

Mientras no exista CLI instalado, una sesión Claude válida y una comprobación suficiente de consumo incluido, el ejecutor estará indisponible. No bloqueará el funcionamiento de Codex.

Cuando se habilite:

- Ejecutar exclusivamente Claude Code CLI oficial, con modelo y esfuerzo explícitos soportados por su versión y plan, y eventos estructurados de su modo de ejecución documentado.
- Consultar `claude auth status` y exigir la sesión de Claude correspondiente; rechazar `api_key`, `api_key_helper`, `third_party` y tokens suministrados externamente en la política personal.
- Verificar configuración y entorno efectivos: una clave de Anthropic, un helper o un cambio a otro proveedor pueden alterar la vía de autenticación. No usar credenciales del Console ni invocar `setup-token` para exportar una sesión.
- Verificar que el uso adicional de pago está desactivado en la cuenta. Estar autenticado por suscripción no demuestra por sí solo esta condición. Si la versión no expone una comprobación fiable, no ejecutar automáticamente bajo el requisito estricto del usuario; no inventar un endpoint privado para conseguirla.
- Ocultar un comando de compra con `DISABLE_EXTRA_USAGE_COMMAND` puede reducir interacciones accidentales, pero **no prueba ni impone por sí solo** que la cuenta tenga el consumo adicional desactivado. Un máximo en dólares tampoco es una garantía de cuota incluida y no será la barrera de seguridad.
- Conservar y mostrar pausa por cuota, desconexión, permisos o verificación pendiente, sin cambiar a Codex u otro proveedor al alcanzar el límite salvo una decisión posterior explícita del usuario y una nueva verificación.

Fuentes: [autenticación de Claude Code](https://code.claude.com/docs/en/authentication), [CLI y estado de autenticación](https://code.claude.com/docs/en/cli-reference), [Claude Code con Pro o Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), [variables de entorno](https://code.claude.com/docs/en/env-vars).

## Jefe, personalización y diseño

Se mantienen las dos vistas aceptadas: Oficina y panel, y Mesa de asignaciones. No se alteran personajes, sprites, mobiliario, desplazamientos, animaciones, colores ni distribución de la oficina en esta revisión. El panel aprobado se conectará al ejecutor cuando exista; no se presentarán como activas las opciones que aún sean una simulación.

Los roles y sus instrucciones/configuración se separarán del aspecto y asiento del personaje. Esto permitirá cambiar nombres, funciones, modelos, esfuerzo y reglas sin editar el motor gráfico ni atar un modelo permanentemente a un personaje.

Auto elegirá dentro de la política; Manual fijará decisiones; Mixto pedirá intervención cuando se excedan sus umbrales. Mantener ahorro, intervenciones del usuario y motivos visibles. No inventar puntuaciones de calidad, equivalencias entre razonamientos de proveedores ni resultados de comparativas no realizadas.

La oficina no interceptará automáticamente todos los mensajes de cualquier aplicación o conversación de Codex. Solo podrá controlar las tareas que entren por su ejecutor; las otras continuarán como observación. Esta distinción evita que un selector visual prometa modificar sesiones ajenas.

## Google Antigravity

Solo reservar el contrato de un adaptador futuro. No implementar cliente, autenticación, descubrimiento de modelos, llamadas Google ni reutilización de suscripciones o credenciales. No se harán comprobaciones de acceso para eludir la restricción indicada por el usuario.

## Orden de implementación y aceptación

1. Control de solo suscripción y diagnóstico seguro del CLI reciente, con pruebas de bloqueos y datos desconocidos.
2. Una tarea Codex administrada y recuperable, comprobaciones antes de cada ejecución, pausa/cancelación y eventos reales hacia la oficina.
3. Cola y Jefe con política reducida, reparto entre roles y límites, manteniendo intervención manual y los modos aceptados.
4. Conectar las dos vistas aprobadas al estado real. Ninguna animación de trabajo sin ejecución comunicada; ninguna confirmación de modelo basada solo en la petición.
5. Añadir Claude cuando se pueda verificar su configuración y suscripción. Mantener Antigravity inerte.

Pruebas obligatorias del nuevo comportamiento: sesión API rechazada, variables/overrides incompatibles rechazados sin exponer valores, créditos o consumo extra no verificables bloqueados, cuota agotada o desconocida sin iniciar procesos, reanudación con nueva verificación, cambio de sesión durante una tarea, aislamiento por proyecto, límites de concurrencia, cancelación sin duplicados, selección manual respetada dentro de la política y ausencia de sustituciones de pago. Usar CLIs simulados y fixtures temporales para estas pruebas; una prueba de inferencia real solo se hará después de superar todas las comprobaciones aplicables.

Las pruebas de regresión de oficina se conservan para carga de recursos, personajes, herramientas, asientos, mascotas y representación de eventos. La aprobación del diseño no equivale a que estos controles ya estén implementados.

## Validación realizada en esta revisión

- `npm test`: 52 pruebas de interfaz/motor, 430 de servidor y 7 de empaquetado, todas correctas.
- `npm run test:standalone`: 7 pruebas de navegador correctas, con entornos temporales y eventos simulados, sin ejecutar modelos reales.
- Total: 496 pruebas existentes correctas. Cubren regresión de lo actual, no certifican el ejecutor futuro.
- El servidor de la oficina actual responde correctamente. No se han cambiado archivos del motor, la interfaz, el ejecutor de arranque ni la configuración activa durante esta revisión.

Solo se ha añadido documentación de revisión y su informe estructurado. La siguiente fase es implementar el control de solo suscripción y una ejecución Codex administrada antes de conectar el reparto multiagente.
