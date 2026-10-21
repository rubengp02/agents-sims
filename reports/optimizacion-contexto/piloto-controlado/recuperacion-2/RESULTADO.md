# Comparación controlada: resultado parcial

21 de octubre de 2026. Repetición autorizada tras renovarse la cuota.
**Tres brazos aceptados; el cuarto cancelado por supervisión.** No se inició otro
piloto ni se ampliaron límites. Evidencia: [resultado bruto](RESULTADO.json),
[protocolo](PLAN.json) y [conservación y cierre](CIERRE.json).

## Condiciones

Los cuatro intentos solicitaron `gpt-6.1-sol` / `low`, Codex CLI
`0.163.0-alpha.10.2`, sesiones nuevas y control oficial de suscripción de ChatGPT,
acreditado en los cuatro recibos. El protocolo no devuelve el modelo confirmado
por el proveedor: `confirmedModel` sigue desconocido.

Misma tarea media, archivos, permisos, criterios y 36 pruebas independientes.
Cada pareja envió exactamente el mismo prompt, incluido el prefijo del ejecutor,
comprobado mediante huella. El Jefe eligió localmente un solo Programador; no hubo
planificación ni revisión con IA. Ambos métodos utilizaron el mismo Codex CLI;
Agent Orchestrator sigue disponible como motor opcional.

Límites conservados: cuatro ejecuciones secuenciales; 480.000 tokens y 16 minutos
totales; 120.000 tokens y 180 segundos de modelo por ejecución; 220 segundos por
brazo completo; cero reparaciones y reintentos automáticos. Sin APIs de pago ni
créditos adicionales, con reserva de cuota y verificaciones oficiales intactas.

## Resultados medidos

El tiempo completo incluye coordinación y comprobaciones locales. La entrada
incluye caché: **la caché no se vuelve a sumar**.

| Ejecución                    |     Entrada | Caché incluida |      Salida | Total tokens |            Tiempo ejecutor | Tiempo completo | Aceptación                       |
| ---------------------------- | ----------: | -------------: | ----------: | -----------: | -------------------------: | --------------: | -------------------------------- |
| Directo, contexto actual     |      56.601 |         42.112 |       1.662 |       58.263 |                   48,990 s |        49,976 s | Aceptado, 36/36                  |
| Oficina, contexto actual     |      56.991 |         28.288 |       1.780 |       58.771 |                   40,883 s |        46,222 s | Aceptado, 36/36                  |
| Oficina, contrato en archivo |      55.392 |         39.552 |       1.770 |       57.162 |                   47,563 s |        50,499 s | Aceptado, 36/36                  |
| Directo, contrato en archivo | Desconocida |    Desconocida | Desconocida |  Desconocido | 44,851 s hasta cancelación |        45,865 s | No aceptado; circuito incompleto |

Los tres primeros superaron además sus dos comprobaciones mecánicas, alcance de
archivos y conservación de Git. El cuarto también superó las 36 independientes,
alcance y Git, pero las dos comprobaciones mecánicas registradas quedaron sin
ejecutar tras cancelarse. No se declara aceptado ni completado.

La pareja con contexto actual consumió **508 tokens más en la oficina (+0,87 %)**
y tardó **3,754 segundos menos (−7,51 %)**. Hay casi igualdad de tokens en esta
pareja equiparada. Una observación no demuestra ventaja estable ni explica por
sí sola todas las diferencias históricas.

La variante mínima de la oficina consumió **1.609 tokens menos (−2,74 %)**, pero
tardó **4,277 segundos más (+9,25 %)** que la oficina con contexto actual.
**No cumple todavía el objetivo de reducir tokens conservando velocidad** y no
se activa como predeterminada. Falta su contraparte directa completa.

## Herramientas, contexto y caché

| Brazo aceptado              | Caracteres del prompt | Herramientas terminadas | Comandos | Eventos de cambios de archivo | Bytes observados de salida de comandos | Turnos completos |
| --------------------------- | --------------------: | ----------------------: | -------: | ----------------------------: | -------------------------------------: | ---------------: |
| Directo actual              |                 2.762 |                       5 |        3 |                             2 |                                  3.045 |                1 |
| Oficina actual              |                 2.762 |                       4 |        3 |                             1 |                                  3.100 |                1 |
| Oficina contrato en archivo |                 1.420 |                       5 |        3 |                             2 |                                  3.046 |                1 |

Sin eventos duplicados, saturación o salidas ausentes en esos recibos. No conocemos
el número exacto de lecturas ni de peticiones internas al modelo. Un evento puede
agrupar varios archivos. Los contadores parciales no equivalen a tokens ni a todo
el trabajo interno.

El prompt mínimo es un 48,6 % más corto, pero su ahorro de tokens es mucho menor.
El contrato se tiene que leer del proyecto; también cuentan las instrucciones
internas y el ciclo de herramientas. Es coherente con la hipótesis de la auditoría,
pero no cuantifica causalmente cuánto aporta cada factor.

La entrada sin caché fue 14.489, 28.703 y 15.840 tokens respectivamente. La caché
varió ampliamente incluso con prompts idénticos; no se manipuló ni igualó su
estado. No se convierten tokens o caché a porcentaje de cuota. Todas fueron
sesiones nuevas: reutilizar el personaje no supuso continuar una sesión. Luna/low
y continuación siguen como experimentos independientes pendientes.

## Incidencia y recuperación

El cuarto brazo activó `supervision_lost` durante la comprobación periódica del
controlador. Esa versión agrupaba errores al leer o validar señales de vida y al
escribir su propia señal. **No registró cuál ocurrió; no podemos afirmar que
muriera un monitor ni atribuirlo a Git, cuota o Codex.** Los diarios finales
muestran señales recientes de ambos monitores, sin explicar el fallo transitorio.
El recibo del ejecutor llama genéricamente `cancelled_by_user` a la señal de
cancelación; aquí la emitió el controlador por supervisión, no el usuario.

Se canceló el modelo, se cerró el registro y se comprobaron detenidos controlador,
supervisor y vigilante, sin trabajador activo. El cierre ocurrió a los
**198,848 segundos** desde el lanzamiento. Los tres recibos completos suman
**174.196 tokens**, más el consumo desconocido del cuarto. El total queda
desconocido: no se acredita que el consumo global final quedara bajo el techo.
No se reabre ni repite automáticamente.

El diagnóstico posterior distingue componente, lectura/validación/escritura y
motivo seguro. Conserva privadamente la primera incidencia y la pausa obligatoria,
aunque falle la escritura diagnóstica. No guarda mensajes crudos, rutas, prompts
ni datos del proveedor. Mantiene límites y plazo de señales de vida. Sus pruebas
son locales; **no se ha demostrado aún la desaparición del fallo en un piloto real**.

Se verificaron intactos los 109 informes anteriores y ambos registros cerrados.
El código ejecutado coincide con la batería completa `validacion-recuperacion-3`.
El diagnóstico posterior tiene validación local separada en
[VALIDACION_DIAGNOSTICO_LECTURA.json](../../recuperacion/VALIDACION_DIAGNOSTICO_LECTURA.json).

## Decisión

Conservar el contexto actual como predeterminado y la variante mínima experimental.
Existe una pareja justa útil, pero no una comparación completa ni una mejora
estable demostrada. Cualquier nueva inferencia necesita autorización de sus límites:
este intento consumió sus cuatro ejecuciones y permanece cerrado. Se conservan
los resultados desfavorables y el consumo desconocido histórico.
