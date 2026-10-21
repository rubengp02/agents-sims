# Piloto real del Jefe adaptativo

21 de octubre de 2026. Ejecutado tras la autorización expresa del usuario para
los límites del [plan preparado](PLAN.json). Una llamada real, sin reintentos ni
reparaciones. La referencia de Codex individual se reutilizó; no se volvió a gastar
cuota en ella. Evidencia: [RESULTADO_REAL.json](RESULTADO_REAL.json).

El propósito era comprobar si la oficina podía resolver el mismo caso medio sin
activar por defecto Arquitecto, Programador y Tester. El Jefe decidió localmente
usar un solo Programador; las comprobaciones de aceptación se ejecutaron mediante
código local, sin pedir a otro modelo que las arrancase.

| Medición                                       | Codex individual histórico | Oficina adaptativa nueva |
| ---------------------------------------------- | -------------------------: | -----------------------: |
| Modelo solicitado                              |                gpt-6.1-sol |              gpt-6.1-sol |
| Razonamiento solicitado                        |                     medium |                      low |
| Entrada total                                  |                     58.064 |                   71.154 |
| Entrada en caché, incluida en la entrada total |                     45.184 |                   51.456 |
| Entrada sin caché                              |                     12.880 |                   19.698 |
| Salida                                         |                      2.277 |                    2.023 |
| Total, entrada más salida                      |                     60.341 |                   73.177 |
| Tiempo completo                                |                   71,676 s |                 48,596 s |
| Tiempo del ejecutor de modelo                  |                   71,239 s |                 42,300 s |
| Aceptación independiente                       |                      36/36 |                    36/36 |
| Pruebas públicas y alcance permitido           |                  Superados |                Superados |

Resultado aceptado para esta tarea: ambas comprobaciones mecánicas locales pasaron,
solo cambiaron `money.mjs` e `invoice.mjs` y se respetaron los límites de 120.000
tokens, 4 minutos totales y 3 minutos de modelo. El registro privado quedó cerrado
con un intento, sin pausa ni motivo de error. La verificación oficial de suscripción
de ChatGPT se realizó antes del turno. Claude continuó desactivado y Antigravity
sin conectar. No se utilizaron APIs de pago ni créditos adicionales.

La oficina tardó **32,2 % menos** que la referencia individual, pero consumió
**21,3 % más tokens totales**. Por tanto, este ensayo no acredita el objetivo conjunto
de reducir tiempo y consumo frente a Codex individual. No se declara una mejora
general ni se promociona automáticamente Sol/low como opción que ahorre cuota.

Frente a la oficina anterior de tres especialistas (209.637 tokens y 194,190 s),
el nuevo caso consume un 65,1 % menos y tarda un 75,0 % menos. Esa referencia anterior
superó la aceptación funcional pero excedió su presupuesto; se conserva ese resultado
desfavorable. La comparación principal sigue siendo con el Codex individual aceptado.

La caché representa el 72,3 % de la entrada nueva, frente al 77,8 % de la referencia.
Los tokens de caché son un subconjunto de la entrada: no se suman otra vez ni se
descuentan para inventar un consumo de cuota. Los contadores disponibles no permiten
convertir tokens a porcentaje de suscripción. Ambas ejecuciones iniciaron sesión
nueva; este ensayo no mide continuación de sesiones ni reutilización de personajes.

La igualdad de archivos iniciales quedó comprobada por hash. Se conservaron contrato,
archivos permitidos y las 36 pruebas independientes. Sin embargo, la referencia usó
medium y CLI directo, mientras el candidato usó low y el puente Agent Orchestrator.
También pueden variar caché y condiciones del servicio. Una pareja histórica no
aísla el efecto de cada cambio ni demuestra fiabilidad general. El CLI no confirmó
el identificador del modelo: la tabla muestra el modelo solicitado y validado como
disponible, sin inventar una confirmación del servidor.

Quedan pendientes reducir las lecturas/contexto que elevan la entrada, contrastar
las cinco estrategias en más casos y medir continuación de sesiones. Cualquier
nueva ejecución real requiere sus propios límites autorizados; este presupuesto
no se reabre ni aumenta automáticamente. No se ha cambiado la interfaz ni los
personajes, escenarios o animaciones para esta prueba.
