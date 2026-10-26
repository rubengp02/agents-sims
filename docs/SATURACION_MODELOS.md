# Saturación y continuación con otro modelo

La autorización del usuario permite continuar un encargo normal cuando Codex
confirma que el modelo está saturado. No se confunden saturación, cuota agotada
y HTTP 429 genérico. Solo se usa el CLI oficial con sesión de ChatGPT y cuota
incluida comprobada nuevamente antes de ejecutar.

## Comportamiento

- Confirmación: error oficial `serverOverloaded`, código `server_is_overloaded`
  o mensaje literal oficial de saturación. Un `turn_rate_limit_exceeded` sin ese
  mensaje explícito y un HTTP 429 por sí solos no autorizan cambiar de modelo.
- Se cierra el intento y sus herramientas antes de la continuación. Solo se
  permite si no empezó ninguna herramienta/aprobación ni se recibió salida del
  modelo. Los cambios anteriores permanecen en disco; no se restaura ni limpia
  el proyecto. Ante una operación incierta se pausa, evitando repetir efectos.
- Como máximo una continuación automática por encargo. Si el sustituto también
  falla, la oficina conserva el motivo y se pausa. Los controles manuales y los
  benchmarks con modelo fijado no cambian de modelo automáticamente.
- Se conserva el recibo original, incluso si su consumo es desconocido. La
  continuación tiene su propio intento, comprobación de cuota y recibo. El total
  histórico no se presenta como conocido si falta un recibo. La cola conserva
  sus controles frente al consumo desconocido.
- El cambio de modelo aparece en la respuesta y persiste al reabrir. Para el
  Jefe se conserva la memoria estructurada del objetivo; la nueva sesión usa el
  modelo sustituto y sus siguientes intervenciones conservan esa elección. El
  Tester mantiene una sesión independiente y los permisos de solo lectura.
- Reiniciar o abrir el historial nunca despacha una continuación pendiente.

## Modelo inmediatamente inferior

El orden de preferencia de la oficina es:

`gpt-6-astra → gpt-6.1-sol → gpt-6-sol → gpt-5.6-sol → gpt-5.6-terra → gpt-6-luna → gpt-5.6-luna`.

Es una política explícita de esta aplicación, no una clasificación universal de
calidad. Se elige el siguiente disponible del catálogo oficial; no se inventan
modelos ni se sube a uno superior. Debe admitir el mismo esfuerzo y, si hay
imágenes, visión acreditada. Si el siguiente disponible no es adecuado, se pausa
sin saltar silenciosamente a otro. Luna solo puede sustituir una petición
informativa sencilla; no se usa como sustituto automático para código, riesgos
relevantes o revisiones del Tester.

La consulta real de catálogo del 26 de octubre confirmó los siete identificadores
en esta cuenta, con entrada de texto e imágenes. Eso acredita el catálogo y no
garantiza disponibilidad instantánea de inferencia.

## Esperas y diagnóstico

Las notificaciones reintentables se muestran como espera del proveedor. Para el
primer aviso que el CLI puede ocultar por WebSocket, el transporte extrae
únicamente categorías y duración de líneas nativas de reintento: no conserva
stderr, mensajes originales ni credenciales. Si aparece un plazo, se informa del
que comunicó el CLI. No se modifica su espera ni se lanzan solicitudes duplicadas.

El temporizador del benchmark se identifica ahora como límite de tiempo, sin
atribuir la parada al usuario. El ensayo conserva su modelo fijado y no convierte
una ejecución con modelos distintos en una comparación válida.

La instancia habitual se actualizó estando inactiva: conserva ocho proyectos,
diez conversaciones, 135 mensajes con las mismas huellas de contenido y diez
referencias de imágenes. No se reanudaron encargos al abrirla.

## Evidencia

Las pruebas locales usan errores simulados: clasificación de saturación frente a
429, extracción del primer aviso, continuación con modelo inferior, rechazo tras
iniciar herramientas, cuota no verificable, cancelación, parada del sustituto,
recuperación sin despacho y conservación de recibos desconocidos. Una simulación
de saturación no acredita que el servicio haya rechazado y recuperado una petición
real; las pruebas reales posteriores se registran por separado en el informe del
benchmark.

La pareja real posterior sobre `500463e` terminó: el Tester respondió en 48.096 ms,
todos los recibos se conservaron y no hubo cambio de modelo. Esa ejecución acredita
la recuperación del recorrido, pero no demuestra que se haya producido y superado
una saturación real. La batería local pasó 1.253 pruebas de servidor (dos omitidas),
106 de interfaz y ocho contratos. El endurecimiento adicional contra operaciones
MCP ya iniciadas pasó 23 regresiones pertinentes con navegador y comandos locales.

La [validación de GitHub](https://github.com/rubengp02/agents-sims/actions/runs/40364720876)
aprobó comprobaciones generales, runtime, paquete y varios grupos E2E. El grupo
macOS 1/3 se canceló sin ejecutar pasos: las anotaciones de GitHub indican que no
se pudo asignar una máquina y que hay restricciones de capacidad en macOS ARM.
No se presenta esa ejecución remota completa como aprobada ni se cambia la
plataforma del job para ocultar la limitación.

Referencias oficiales: [errores del protocolo](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/schema/json/v2/ErrorNotification.json),
[primer reintento oculto](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/responses_retry.rs)
y [significado de saturación según un mantenedor de OpenAI](https://github.com/openai/codex/issues/19583#issuecomment-4406790538).
