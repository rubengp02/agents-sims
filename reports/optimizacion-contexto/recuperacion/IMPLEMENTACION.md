# Recuperación reforzada y repetición autorizada

21 de octubre de 2026. El usuario pidió «refuerza la recuperación y repítelo» tras
el intento interrumpido. La repetición conserva exactamente los límites aprobados:
cuatro llamadas Sol/low con Codex CLI, 480.000 tokens y 16 minutos totales,
120.000 tokens y tres minutos de modelo por llamada, sin reparaciones ni reintentos
automáticos. El brazo completo conserva su máximo de 220 segundos. No se reabre
el registro anterior ni se interpreta su consumo desconocido como cero.

## Qué cambió

El piloto nuevo usa tres procesos mecánicos, que no son agentes de IA:

- Un supervisor oculto se inicia independiente del canal de terminal. Registra
  el proceso controlador y su hora de creación.
- El controlador conserva toda la orquestación, verificaciones de suscripción,
  aceptación y presupuesto del piloto. Registra el proceso CLI antes de enviarle
  el prompt, publica contadores seguros y emite señales periódicas de vida.
- Un vigilante independiente comprueba el controlador y al supervisor, y aplica
  los plazos de modelo, brazo y piloto. El supervisor también detecta la pérdida
  del vigilante. Una pérdida detiene los procesos propios y cierra el intento.

El código comprueba PID y hora de creación antes de terminar un proceso para no
actuar sobre un PID reutilizado. No busca ni mata todos los procesos de Codex.
El registro del CLI ocurre antes de escribir el prompt en su entrada estándar;
si no puede acreditar su propiedad, la ejecución se bloquea y no se envía el encargo.
Los procesos de comprobación de cuenta siguen siendo los oficiales existentes.

Los archivos de estado se escriben mediante sustitución atómica y cada monitor
tiene su propio archivo para evitar que pisen sus señales de vida. Un bloqueo
exclusivo evita dos cierres simultáneos. La evidencia de control está fuera de la
carpeta editable del trabajador. No contiene credenciales ni prompts.

La acción local `inspect` reconcilia un estado abierto si desaparecieron los dos
monitores: termina solo el trabajador de identidad acreditada y cierra como pausa
y consumo desconocido cuando falta un recibo completo. Nunca inicia llamadas,
reanuda un trabajo o crea otro presupuesto. Si hay datos corruptos, identidad no
acreditable o un cierre interrumpido que no pueda verificarse, requiere revisión;
no declara una terminación o consumo que no pueda demostrar.

El reloj global parte del lanzamiento del supervisor, compartido por el controlador
y el vigilante. El arranque no renueva los 16 minutos. Los plazos solicitan parada
al vencer; la terminación de procesos tiene latencia y los tokens pueden comunicarse
al cerrar un turno. No se promete un techo exacto de generación ni conocer el
consumo remoto tras perder la respuesta. Un exceso o dato desconocido sigue
invalidando cualquier afirmación de mejora y bloquea llamadas posteriores.

## Qué permanece igual

La tarea media, modelo y razonamiento, orden de los cuatro brazos, hashes de
prompts emparejados, archivos iniciales, permisos, catálogo permitido y controles
de ChatGPT se mantienen. Se ejecutan las pruebas públicas, la aceptación registrada,
las 36 comprobaciones independientes y los controles de alcance y Git. El Jefe
elige localmente un solo Programador. No se activa un Tester de IA ni se rebajan
requisitos para que pase el ensayo.

La variante mínima sigue siendo experimental. El motor AO continúa opcional;
Claude permanece desactivado y Antigravity desconectado. No cambian interfaz,
personajes, escenarios o animaciones. Tampoco se modifican autenticación,
configuración global ni cuotas de la cuenta, ni se utiliza facturación por API.

## Fallos locales conservados

[PRUEBAS_PROCESOS.json](PRUEBAS_PROCESOS.json) conserva los intentos:

1. Cinco de seis pruebas de procesos fallaron inicialmente: PowerShell devolvía
   un PID pero los conductos redirigidos mantenían el lanzamiento esperando.
   Se retiró esa dependencia; los supervisores escriben diarios estructurados propios.
2. Las seis pruebas originales de procesos pasaron después con las mismas
   expectativas: salida del lanzador, pérdida del controlador, pérdida del supervisor,
   pérdida del vigilante, plazo independiente y protección contra PID reutilizado.
3. Una batería posterior encontró una prueba de aplicación que aguardaba solo un
   segundo al cierre de comprobaciones locales. Se amplió únicamente esa espera
   a cinco segundos, conservando los estados y números de llamadas exigidos.
   El fallo y la validación anterior se conservan.

Se añadió un séptimo escenario de supervisión para reconciliar después de perder
ambos monitores, y una prueba que impide ejecutar directamente o copiar a otra
carpeta un intento que exige supervisión. Todas estas pruebas son locales: sus
trabajadores son procesos Node falsos y no consumen modelos.

## Evidencia de la repetición

El nuevo intento se aloja en `piloto-controlado/recuperacion-1`, con plan, autorización
privada y registro exclusivos. Los datos del intento anterior permanecen intactos.
El resultado real se documentará allí, separado de las pruebas de infraestructura.
La nueva cota no permite sumar los 480.000 tokens de este ensayo y afirmar un coste
global conocido: el intento histórico interrumpido sigue teniendo consumo desconocido.

La comparación tiene una pareja por variante y no activa un contexto nuevo en
producción. Deben considerarse el tiempo de supervisión, los contadores reales,
las pruebas y todos los fallos; una reducción del tamaño del prompt por sí sola
no demuestra ahorro de cuota.

## Cierre y seguimiento del 21 de octubre

`recuperacion-1` se cerró antes de enviar un prompt al modelo por la reserva de
cuota: el control observó un 99 % utilizado. Se conserva ese resultado bloqueado.
Tras renovarse naturalmente la ventana, el usuario indicó «continua» y se inició
un registro nuevo, `recuperacion-2`, con los mismos límites.

La batería completa previa superó tipos, lint, 735 pruebas de aplicación/paquete,
47 pruebas de políticas, runtime nativo simulado, siete escenarios de procesos,
siete simulaciones de contexto y empaquetado. Está conservada en
`../validacion-recuperacion-3.json`; no gastó cuota de modelos.

La repetición real terminó con tres brazos aceptados y el cuarto cancelado por
una comprobación periódica de supervisión. El cierre y limpieza se verificaron;
no hubo reintentos. El detalle, resultados parciales y límites de interpretación
están en [el informe de recuperacion-2](../piloto-controlado/recuperacion-2/RESULTADO.md).
La causa concreta del aviso genérico no puede reconstruirse de sus registros.

Se añadió después un diagnóstico seguro que separa errores de lectura, señales
caducadas, identidad ausente y escritura de la señal propia. No relaja la pausa ni
amplía los plazos. Sus nueve pruebas de supervisión y las ocho del piloto
controlado pasaron localmente. El primer resumen automático leyó cero pruebas
porque esperaba TAP y Node emitió el formato spec; se conserva ese fallo y una
lectura corregida de la misma salida, sin repetir pruebas ni alterar sus resultados:
`VALIDACION_DIAGNOSTICO.json` y `VALIDACION_DIAGNOSTICO_LECTURA.json`.

No se ha ejecutado otro modelo después de añadir el diagnóstico. La fiabilidad
de la comparación real sigue pendiente de completar con autorización nueva;
no se promueve la variante mínima ni se anuncia ahorro estable.
