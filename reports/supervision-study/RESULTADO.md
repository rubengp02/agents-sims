# Supervisión: estudio acotado del 22 de octubre de 2026

## Resultado y estado

La recuperación con procesos del sistema operativo está validada en este estudio.
La intermitencia sigue abierta, **no reproducida**. La causa del incidente original
permanece indeterminada. No se declara una corrección de causa ni se cierra como
resuelta una incidencia por obtener ejecuciones verdes.

Ejecución de GitHub: [39690566215](https://github.com/rubengp02/agents-sims/actions/runs/39690566215),
commit `1f47daa0ba48a35ee79512ad82f55636bf98c57e`, Node `v22.23.3`.
El workflow finalizó con `success` en ambos sistemas.

| Sistema | Repeticiones completas | Comprobaciones | Tiempo del estudio |
| ------- | ---------------------- | -------------- | ------------------ |
| Linux   | 5/5                    | 65/65          | 62,771 s           |
| Windows | 5/5                    | 65/65          | 141,926 s          |

Los tiempos son los de cada bucle de pruebas, excluyendo preparación del runner
e instalación. Las dos ramas se ejecutaron en paralelo. No se suman para afirmar
tiempo de pared global.

Evidencia descargada de los artefactos oficiales, conservada sin reinterpretar:
[Linux](20261022-39690566215/linux.json) y
[Windows](20261022-39690566215/win32.json).

## Qué prueban estos resultados

Son procesos reales de Node y señales del sistema, con fallos controlados:
pérdidas de controlador, supervisor, vigilante y descendiente; pérdida conjunta;
escritura interrumpida; errores de lectura/escritura; identidad de PID; cuatro
trabajadores consecutivos; consumo desconocido; pausa y rechazo de reintentos.
Las respuestas del proveedor no participan. Inferencias: **0**. No mide tokens,
calidad de respuestas de modelos ni funcionamiento bajo toda carga posible.

No se cambiaron plazos, lógica de supervisión ni criterios de aceptación para
este estudio. No se hizo una reparación especulativa del runtime.

## Fallos anteriores y límite de la investigación

En la ejecución [39685985797](https://github.com/rubengp02/agents-sims/actions/runs/39685985797),
el job `119520627283` registró `supervision: FALLO (11896 ms)` y
`VALIDACION-ef7abf06.json`. El verificador guardó el detalle en un registro privado
del runner efímero que no fue publicado como artefacto. El log disponible no
identifica la prueba fallida. No es posible reconstruirla con esa evidencia.
Se conserva como fallo real observado de la suite, sin atribuirlo a una causa.

La ejecución completa [39687945192](https://github.com/rubengp02/agents-sims/actions/runs/39687945192)
pasó posteriormente, incluida supervisión. Este estudio añade diez suites
completas sin fallos, pero no elimina el resultado adverso previo ni garantiza
ausencia de intermitencias.

## Diagnóstico reproducible y límites

Se añade `scripts/repeat-supervision.mjs` y el workflow manual
`Supervision study (no inference)`. El workflow ejecuta cinco repeticiones por
sistema, con límite de 15 minutos por job; el script admite 1–10 repeticiones,
120 segundos por suite y no inicia otra después de 12 minutos. Se detiene ante
el primer fallo por sistema. Cada intento conserva resultado, código, señal,
contadores y nombres TAP de fallos cuando existen; los logs crudos permanecen
privados. Los artefactos públicos contienen únicamente el resumen estructurado
y caducan a los siete días; las copias de este informe permanecen en Git.

El commit del estudio usa `[skip ci]` para no repetir el CI completo durante una
investigación centrada en procesos. Se ejecutó explícitamente el workflow del
estudio sobre ese commit; no se presenta un CI omitido como validación completa.
Tipos y controles de archivos generados pasaron en el hook de publicación.

Si vuelve a fallar: conservar el intento, identificar el caso y reproducirlo
antes de modificar la lógica. Si la suite agota su tiempo o falla antes de
producir TAP, el resumen conservará ese fallo aunque no haya nombre de prueba.
Para cerrar como causa corregida hace falta una reproducción atribuible y una
regresión que falle antes del arreglo y pase después. Eso sigue pendiente.
