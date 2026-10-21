# Primer ejecutor oficial de Codex

Implementado: una tarea real por vez mediante el CLI oficial local, con modelo y razonamiento explícitos. No hay SDK de inferencia, claves API, compras, recargas, cambios de cuenta, resets de cuota ni proveedor alternativo. No se ha modificado el diseño de la oficina.

## Uso sencillo

Desde la carpeta superior:

- `COMPROBAR-AGENTES.cmd`: comprueba conexión, suscripción, cuota y modelos. No envía una tarea a un modelo.
- `EJECUTAR-TAREA.cmd`: pide carpeta y tarea; muestra estados y respuesta. Solo lectura por defecto, GPT-6.1 Sol, esfuerzo bajo. Ctrl+C cancela el proceso propio y sus descendientes.
- `ABRIR-OFICINA.cmd`: la oficina original sigue observando las sesiones que Codex registra. El ejecutor conserva la sesión oficial, por lo que el observador puede detectarla sin una segunda integración. Puede haber demora y una respuesta breve sin herramientas puede terminar antes de que se represente trabajando.

Desde `pixel-office`, con una tarea escrita en un archivo de texto local:

```powershell
npm run agent:check
npm run agent -- run --project "RUTA_DEL_PROYECTO" --task-file "TAREA.txt" --model gpt-6.1-sol --effort low
```

Para permitir modificaciones dentro de la carpeta del proyecto, añadir `--write`. Conserva el sandbox `workspace-write` y no habilita permisos ilimitados. No es un permiso para commits, push o cambios de rama. Una acción que requiera permisos adicionales no se acepta automáticamente.

El texto se entrega por stdin, nunca se convierte en un comando shell. La interfaz del navegador también inicia y cancela tareas desde **Equipo**, mediante endpoints locales protegidos. El WebSocket original sigue dedicado a la oficina. Consulta [Equipo multiagente](EQUIPO_MULTIAGENTE.md) para el planificador, las asignaciones y los límites de la cola.

## Comprobaciones obligatorias

El ejecutor busca instalaciones locales conocidas y el PATH, consulta su versión y selecciona una compatible reciente. La instalación antigua no prevalece por aparecer primero. Actualmente se requiere Codex CLI 0.163 o posterior, por su soporte de ejecución con configuración de usuario ignorada. No descarga ni actualiza nada.

Antes de cada tarea y periódicamente durante ella:

1. Consulta metadatos con el propio proceso `codex app-server` por stdin/stdout. La aplicación no abre conexiones de inferencia ni importa tokens. No invoca login, logout, renovación forzada de credenciales, compra de créditos ni endpoints de pago.
2. Exige `account.type=chatgpt`, `requiresOpenaiAuth=true` y plan personal Plus o Pro. Los otros planes y proveedores quedan bloqueados mientras no exista una verificación apropiada de consumo incluido.
3. Exige cuota vigente y verificable en los buckets devueltos, sin límites alcanzados. Conserva un margen local del 10%: no inicia o pausa al comunicar un uso del 90% o superior.
4. Exige que el proveedor comunique `credits.hasCredits=false`, `credits.unlimited=false` y saldo cero. Datos ausentes, saldo adicional, inconsistencias o errores bloquean el inicio; durante la tarea causan una pausa. No se interpreta un dato ausente como cero.
5. Valida modelo y esfuerzo contra el catálogo del mismo CLI. Nunca cambia silenciosamente a otro modelo, cuenta o proveedor. Un catálogo no es una garantía de acceso a inferencia: una denegación del CLI se conserva como fallo.

La ejecución usa `codex exec --ignore-user-config`, proveedor oficial OpenAI, método de sesión ChatGPT y esfuerzo explícitos. No hereda claves, URLs alternativas ni variables arbitrarias: usa una lista reducida de variables de sistema y bloquea nombres de variables incompatibles sin mostrar sus valores. Desactiva aplicaciones/MCP, plugins, delegación adicional y búsqueda web en esta primera versión, y no solicita modos Fast/Ultrafast. Conserva las instrucciones de proyecto y las reglas de ejecución del CLI; no utiliza `--ignore-rules` ni opciones de bypass de permisos.

Una notificación de cambio de cuenta, pérdida de verificación, límite del proveedor, tiempo máximo o cancelación detiene el proceso propio. No hay reintentos automáticos. El ejecutor admite una tarea exclusiva o hasta dos lectores independientes autorizados por el coordinador, con quince minutos como máximo por tarea. El proveedor sigue siendo la autoridad sobre la cuota: el 10% es un margen prudente, no una predicción exacta de tokens o garantía de corte instantáneo. La cuota se comparte con los demás clientes. La aplicación no cambia las preferencias de facturación de la cuenta ni promete reservar cuota frente a cambios externos; revalida el estado comunicado y no permite iniciar con evidencia de saldo adicional o datos desconocidos.

## Registro y privacidad

Los registros viven en `.local-office/executions/`, ignorados por Git. Guardan identificador de tarea/sesión, carpeta, estados, modelo y esfuerzo solicitados, tiempos, motivos locales y tokens que comunique el CLI. No guardan prompt, respuesta, herramientas, stderr, email ni credenciales. Codex gestiona por su cuenta sus transcripciones y autenticación habituales.

El CLI JSON de esta versión no comunica el modelo de inferencia confirmado en los eventos usados. Por eso `confirmedModel` queda en null y se muestra «no comunicado»; no se inventa una confirmación. Los argumentos de lanzamiento sí fijan modelo y esfuerzo reales del CLI. La ocupación de contexto de la oficina y la cuota restante son medidas distintas.

Los estados de pausa/cancelación conservan la referencia de sesión. El Jefe ya puede repartir tareas desde **Equipo**. Continuar una tarea pausada requiere una acción explícita y crea una ejecución nueva; no se promete recuperar automáticamente el mismo contexto. Un cierre forzoso ajeno al cierre normal puede dejar `executor.lock`: el ejecutor bloquea una nueva tarea para evitar duplicados hasta revisar ese cierre. El lanzador normal espera a que el servicio detenga sus procesos antes de terminar el servidor, también en Windows.

## Otros proveedores

Claude está desactivado inicialmente. Ya tiene adaptador de diagnóstico oficial y constructor de argumentos, pero la inferencia sigue bloqueada por falta de una comprobación oficial previa del consumo adicional. Habilitar su comprobación puede iniciar `claude auth status`, sin inferencia ni lectura de credenciales. La cola de dos proveedores solo se ha probado conjuntamente con simulaciones. Antigravity mantiene una reserva y rechazo explícito, sin cliente Google.

## Verificación inicial del ejecutor

- 54 pruebas nuevas offline con un proceso local simulado: autenticación, planes, créditos, cuota, entorno, catálogo, ejecución, privacidad, cancelación, pausa, límites y concurrencia. No usan una IA.
- Prueba real única, autorizada tras comprobar suscripción: GPT-6 Luna, `low`, solo lectura, sin herramientas. Resultado exacto `OFICINA_OK`; 14.009 tokens de entrada y 8 de salida comunicados por el CLI. Incluyen el contexto que el CLI carga, no solo el texto de la petición. No se convierten a euros ni a porcentaje de cuota.

Fuentes oficiales del protocolo y las opciones: [Codex CLI](https://learn.chatgpt.com/docs/cli/reference), [App Server](https://learn.chatgpt.com/docs/app-server), [autenticación](https://learn.chatgpt.com/docs/auth).

La verificación posterior de la cola y el panel se documenta en
`reports/equipo-cli/VERIFICACION.md`. Sus comprobaciones reales son adicionales a
la prueba inicial descrita arriba.
