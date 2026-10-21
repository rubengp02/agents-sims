# Comparación real terminada: no demuestra ventaja de la oficina

21 de octubre de 2026. Se ejecutaron las tres etapas autorizadas, con el CLI oficial
y sesión de suscripción, sin cambiar sus límites ni reintentar resultados fallidos.
Se hicieron **6 ejecuciones CLI reales**, de un máximo de 10, y se comunicaron
**336.338 tokens**, de un techo de 880.000. Transcurrieron aproximadamente **5 min
23 s** desde el inicio del conjunto hasta el último recibo, dentro de los 23 minutos.

`completed` en el informe del conjunto significa que terminaron los recorridos
previstos; **no significa que todos fueran aceptados**. Los resultados originales
se conservan, incluidos `both_failed` en media y difícil. La auditoría posterior
identificó limitaciones del verificador que impiden interpretar esas etiquetas
automáticas como fallos funcionales inequívocos del modelo.

## Datos medidos

| Caso    | Método        | Entrada | Salida | Caché incluida en entrada |  Total | Tiempo del método | Tests funcionales originales |
| ------- | ------------- | ------: | -----: | ------------------------: | -----: | ----------------: | ---------------------------- |
| Fácil   | Codex directo |  41.694 |    448 |                    27.264 | 42.142 |          22,552 s | 15/15                        |
| Fácil   | Oficina       |  41.776 |    336 |                    36.608 | 42.112 |          22,310 s | 15/15                        |
| Media   | Codex directo |  60.552 |  2.213 |                    50.560 | 62.765 |          66,066 s | 32/36                        |
| Media   | Oficina       |  41.668 |    551 |                    26.880 | 42.219 |          26,785 s | 10/36; sin implementación    |
| Difícil | Codex directo |  83.270 |  4.723 |                    62.848 | 87.993 |         127,257 s | 15/16                        |
| Difícil | Oficina       |  57.830 |  1.277 |                    41.472 | 59.107 |          54,440 s | 2/16; sin implementación     |

Los tiempos incluyen preparación del método, asignaciones, ejecución y comprobaciones
locales/finales. Los tres papeles previstos por cada recorrido de oficina en media
y difícil no llegaron a ejecutarse: ambos recorridos se detuvieron en su Arquitecto. En total hubo un
Programador de oficina en fácil, dos Arquitectos y tres ejecuciones directas.
No se ejecutaron Programador ni Tester de oficina en media/difícil.

Los tests que pasan sobre el código inicial de la oficina no son trabajo realizado
por el Arquitecto. Consumir menos y terminar antes sin implementar no se contabiliza
como ahorro válido. Hubo **cero reparaciones externas y cero reintentos**.

Totales del conjunto: 326.790 de entrada, 9.548 de salida, 245.632 de entrada en
caché y 81.158 de entrada sin caché. El intento de calibración anterior mantiene sus
56.873 tokens por separado: sumarlo eleva el consumo conocido de esta comparación
y su calibración a **393.211**. No incluye otros estudios históricos ni este chat.

## Interpretación por dificultad

**Fácil: empate práctico.** Ambos métodos superaron aceptación, pruebas públicas y
control de archivos. La oficina gastó 30 tokens menos (aproximadamente 0,07 %) y
tardó 242 ms menos. Una observación por método, sin caché fría ni orden alternado
dentro del caso, no permite atribuir significación ni estabilidad a esa diferencia.
No hay una ventaja útil demostrada.

**Media: la oficina se bloqueó; el contrato de aceptación necesita precisión.**
El Arquitecto entregó decisiones de implementación y ejecutó pruebas del código
inicial. Como esas pruebas fallaban, terminó con `OFFICE_RESULT failed`. El
coordinador obedeció esa declaración y pausó Programador y Tester.

Codex directo implementó ambos módulos, superó las pruebas públicas y 32 de las 36
comprobaciones externas. Las cuatro negativas exigen `RangeError` para cantidades
y descuentos `1.2` o `NaN`; el código devuelve `TypeError`. El contrato distingue
tipo incorrecto y fuera de rango, pero no define claramente cómo clasificar esos
números no enteros. La referencia/oráculo elige una interpretación más específica
que la redactada. No se puede atribuir esa discrepancia sin reservas al modelo.
No se cambió el oráculo después de ver el resultado ni se recalculó un ganador.

**Difícil: la oficina repitió el bloqueo; Codex directo siguió el contrato literal
en la comprobación discrepante.** El Arquitecto completó el análisis y señaló
correctamente los defectos iniciales, pero declaró `failed` por las pruebas
iniciales fallidas. Volvieron a quedar sin ejecutar Programador y Tester.

La implementación directa pasó 15 de las 16 comprobaciones externas. La única
negativa, `invalid-submit`, agrupa varios casos y exige rechazar un id formado
por espacios. El contrato solo exige un string no vacío: `' '` no está vacío.
La auditoría confirmó que el código rechaza el string vacío, ids de tipo inválido
y un job no funcional con `TypeError`, pero acepta `' '`. Esa exigencia adicional
del oráculo **no estaba especificada**. Fue un defecto del diseño del test, no un
defecto demostrado de la implementación. La batería no prueba exhaustivamente que
la implementación esté libre de otros problemas.

## Hallazgo de coordinación

La instrucción común de resultado del ejecutor dice que se declare `failed` si las
pruebas fallan. Eso choca con un análisis previo de código deliberadamente defectuoso:
el rol puede completar correctamente el diagnóstico aunque el producto aún falle.
En las dos ejecuciones de Arquitecto ocurrió exactamente eso, confirmado leyendo
solo sus respuestas finales oficiales durante la auditoría.

La oficina necesita criterios de finalización propios de cada papel: análisis
entregado, implementación realizada y aceptación del producto son estados distintos.
Ese problema estaba ausente de las simulaciones porque sus Arquitectos declaraban
siempre `completed`. Por tanto, las pruebas locales pasadas no garantizaban el
comportamiento de los modelos reales en ese flujo.

No se ha cambiado ese contrato ni reparado los casos durante la medición. No se ha
gastado el resto de intentos disponibles para sustituir resultados desfavorables.

## Controles y auditoría

Se verificaron los seis recibos `subscription-only` contra sus contadores y sesiones.
Cada ejecución pasó la verificación oficial de suscripción. Todos solicitaron
GPT-6.1 Sol, con esfuerzo fijo dentro de cada caso (bajo/medio/alto) y CLI
0.163.0-alpha.10.2. El CLI no comunicó modelo confirmado: ese campo sigue desconocido.
Los seis identificadores de sesión son distintos; no hubo `resume`.

Los hashes iniciales coinciden dentro de cada pareja. Todos los cambios se limitaron
a los archivos permitidos. Los límites por método fueron iguales y no se alcanzaron
ni ampliaron. Los logs y las respuestas finales se mantuvieron en almacenamiento
local privado. El informe público solo incorpora resultados, contadores y causas.
Claude no se activó y Antigravity no se conectó. No hubo APIs de pago, créditos
adicionales ni manipulación de credenciales.

La auditoría volvió a ejecutar **localmente**, sin IA, los seis verificadores sobre
los archivos resultantes: reprodujeron exactamente los resultados originales.
También comprobó los casos de excepción e identificadores discrepantes. El código
de la aplicación y los scripts conservaron la misma huella que al empezar el ensayo.

## Conclusión y trabajo pendiente

**No se ha demostrado una mejora del sistema frente a Codex directo.** En fácil,
ambos son prácticamente iguales. En media y difícil, Codex directo produjo código
y la oficina se quedó en análisis por su contrato de finalización. Las ambigüedades
de aceptación impiden una clasificación limpia del resultado directo en esos casos.

Antes de otro ensayo conviene corregir la finalización por rol y especificar
explícitamente los errores de valores no enteros/`NaN` y la regla sobre ids con
espacios. Después habría que validar los verificadores y realizar una comparación
nueva, conservando estos fallos. Eso **queda pendiente**, sin ejecución ni
autorización presupuestaria nueva. No es necesario ampliar los límites para abordar
estos defectos locales; los límites v2 sí permitieron terminar el ensayo completo.

Evidencia: [auditoría consolidada](AUDITORIA_REAL.json),
[conjunto real](suite-real.json), [fácil](easy-real.json),
[media](medium-real.json) y [difícil](hard-real.json).
