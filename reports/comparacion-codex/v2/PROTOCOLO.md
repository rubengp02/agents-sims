# Comparación completa v2: límites simétricos por método

Seguimiento: el conjunto fue autorizado y ejecutado. Consulta los
[resultados reales y sus limitaciones](RESULTADOS_REALES.md). El estado de
preparación que sigue es histórico y se conserva con los límites originales.

21 de octubre de 2026. Estado: **preparado y probado localmente; sin nuevas
ejecuciones reales**. Esta versión sustituye el diseño de presupuesto de v1 para
la próxima comparación. Conserva sus datos y su registro cerrado.

## Por qué se cambian los límites

El primer intento real de Codex directo reparó el caso fácil y superó las 15 pruebas
funcionales, pero comunicó 56.873 tokens con cinco herramientas. El umbral anterior
de 30.000 por ejecución era insuficiente. De esos 56.873 tokens, 40.960 eran entrada
en caché; se cuentan también para controlar el presupuesto. No se convierten a
dinero ni a un porcentaje de cuota de la suscripción.

La nueva referencia son esos datos: el límite fácil de 90.000 por método deja un
margen aproximado del 58 % sobre el único consumo observado. Los márgenes de media
y difícil son hipótesis de capacidad por el trabajo entre módulos y las revisiones;
no proceden de consumos reales medidos de esas tareas. Se mantienen limitados a
150.000 y 200.000 por método, sin ampliar el catálogo ni el presupuesto normal de
la aplicación.

## Límites fijados antes de medir

| Caso    | Tokens por método | Tiempo por método | Techo de la pareja | Tiempo de etapa | Intentos CLI |
| ------- | ----------------: | ----------------: | -----------------: | --------------: | -----------: |
| Fácil   |            90.000 |             2 min |            180.000 |           5 min |            2 |
| Media   |           150.000 |             3 min |            300.000 |           7 min |            4 |
| Difícil |           200.000 |        4 min 30 s |            400.000 |          10 min |            4 |

**Techo conjunto: 880.000 tokens comunicados, 10 intentos CLI y 23 minutos**.
La suma de tiempos de etapa es 22 minutos; el minuto restante cubre arranque y
cierre del conjunto. Es un máximo, no una previsión de gasto ni una reserva de
cuota del proveedor. El gasto real puede ser considerablemente menor.

Codex directo y oficina reciben el **mismo total de tokens y tiempo por caso**.
La oficina comparte su asignación entre Arquitecto, Programador y Tester cuando
corresponde; cada personaje no recibe una bolsa completa adicional. El método
directo conserva una sesión con herramientas y puede iterar dentro de ella.
No se añaden reintentos externos ni reparaciones automáticas para ningún método.

La reserva de arranque es 20.000 tokens para ambos métodos. **No es un techo de
ejecución**: cada llamada recibe como umbral el saldo restante de su método. Se
separan así la estimación mínima para arrancar de la cantidad máxima que puede
consumir. El caso de 56.873 tokens cabe sin cambiar límites durante la ejecución.

Para la oficina, una opción local de reserva del coordinador aplica esa misma
estimación al siguiente papel. Evita reservar otra vez el coste acumulado de todo
el trabajo del Programador como si fuera el coste mínimo de iniciar al Tester.
No cambia la contabilización del consumo real ni el techo de su método. El
coordinador normal conserva su comportamiento anterior cuando no se pasa esta
opción; no se ha cambiado la configuración guardada del usuario.

Si un turno supera su saldo antes de informar del consumo, se conserva el exceso y
se pausa. No se empieza el otro método con una asignación reducida para compensarlo.
También se exige disponer de su tiempo completo al iniciarlo. No hay transferencias
de presupuesto entre métodos, aumentos automáticos ni reinicios tras una pausa.

El CLI comunica consumo al final del turno: **no hay una garantía de corte exacto
durante la generación**. Los límites nuevos reducen el riesgo de quedar cortos,
pero no garantizan terminar cualquier ejecución. Las cuotas del proveedor, una
pérdida de verificación o un consumo desconocido siguen deteniendo el conjunto.

## Comparación y calidad

Se conservan los tres contratos y los verificadores de v1: etiquetas, factura en
dos módulos y cola concurrente. Tienen 15, 36 y 16 comprobaciones externas, además
de pruebas públicas y control de archivos modificables.

Cada pareja empieza con los mismos bytes y en carpetas nuevas. Ambos métodos
reciben el contrato completo y las mismas pruebas. Se mantienen modelo solicitado
GPT-6.1 Sol y esfuerzo iguales dentro de cada caso: bajo, medio y alto respectivamente.
La oficina usa su coordinador y selección local reales. Los revisores conservan
solo lectura. La suscripción y el catálogo se verifican antes de cada ejecución
oficial; Claude permanece desactivado y Antigravity sin conectar.

Se registran por separado **calidad funcional**, **finalización del recorrido** y
**cumplimiento de presupuesto**. Si el código supera los tests pero se excede un
límite, el resultado será `budget-exceeded`, sin inventar defectos funcionales.
No se considera ganador a un método que se haya pasado de su asignación.

El intento anterior se conserva como **calibración**, con sus 56.873 tokens y su
pausa original. No se reetiqueta como éxito de v2 ni se mezcla con sus recorridos.
Se repetirá la pareja fácil con las reglas nuevas para ambos métodos, registrando
también el coste histórico del estudio por separado. No se ocultan intentos fallidos.

Las métricas incluyen entrada, salida, caché, entrada sin caché, tiempos completos,
llamadas, pruebas, cambios, bloqueos y reparaciones externas (cero). Las sesiones
serán nuevas; caché o personaje reutilizado no equivalen a continuar una sesión.
El orden sigue prefijado: directo/oficina, oficina/directo, directo/oficina.
No se controla caché fría ni se borra para fabricar una diferencia.

Una pareja por dificultad será exploratoria. Puede revelar una ventaja o un
intercambio de tiempo y consumo en esos casos; no demuestra superioridad estable
para todos los trabajos. No se promedia un caso con calidad insuficiente como si
fuera un ahorro válido.

## Ejecución hasta el final

El lanzador admite **una autorización previa para el conjunto completo**. Con ella
ejecutará fácil, media y difícil por orden, sin pedir confirmación entre etapas que
terminen y conserven controles verificables. Cada etapa y el conjunto tienen
registros exclusivos: cerrar o repetir el comando no concede presupuestos nuevos.

Un fallo de cuota, verificación, consumo desconocido, cancelación o límite pausa el
conjunto. No se saltan etapas incompletas para buscar resultados favorables. Un
fallo funcional con ambos recorridos terminados se conserva como resultado y puede
dar paso al siguiente caso; no se repara a escondidas.

Los borradores bajo `.local-office/comparison-v2/authorizations/` tienen
`approved=false`. La autorización conjunta fija versión, huellas, límites, alcance
`all`, motivo humano y caducidad. Una autorización v1 o de un solo caso no permite
arrancar el conjunto v2. La preparación no autoriza ni inicia inferencia.

```powershell
# Solo pruebas y preparación local, sin modelos:
npm run benchmark:v2:prepare
npm run benchmark:v2:test

# Solo después de autorizar el presupuesto conjunto:
npm run benchmark:v2:run -- --all
```

El lanzador conserva también la posibilidad de autorizar un caso concreto; esa
autorización no se propaga al resto. Los metadatos públicos omiten prompts,
respuestas, credenciales y rutas personales. Logs y autorizaciones permanecen
en el directorio local ignorado por Git.

## Comprobaciones realizadas

Las pruebas locales completan las tres parejas y el conjunto entero usando el
coordinador real con ejecución simulada. Reproducen los contadores observados de
56.141 de entrada y 732 de salida, comprueban el saldo decreciente de los
especialistas y un caso de 110.000 tokens de entrada del Programador seguido del
Tester dentro del techo compartido. Esos contadores de simulación no son mediciones
de ahorro ni una previsión de consumo real.

También se prueban sobreconsumo con código funcional correcto, reserva íntegra
para el otro método, pausa por datos desconocidos, caducidad y alcance de la
autorización, cierre persistente y conservación del intento v1. Los tests originales
del comparador siguen pasando. Tipos, lint, suites de aplicación, estudio y
empaquetado se verificaron localmente; permanece la advertencia previa de hooks
en `App.tsx`.

Datos de preparación: [preparacion-local.json](preparacion-local.json).
Configuración exacta: [protocolo.json](protocolo.json).
Auditoría de estado y conservación: [VERIFICACION.json](VERIFICACION.json).
