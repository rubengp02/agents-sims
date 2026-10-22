# Verificación de la primera entrega

Fecha: 22 de octubre de 2026.

Este documento conserva el resultado de la revisión inicial. Las carencias
identificadas se abordaron después en la entrega de
[conversaciones guardadas](VERIFICACION_CONVERSACIONES.md).

**Resultado: entrega abierta.** Se ha verificado la recuperación de las tareas y
el recorrido de sus comprobaciones locales. Eso todavía no acredita un proyecto
registrado y recordado de forma independiente, con sus comprobaciones aprobadas.

## Qué se ha ejecutado

Se añadieron cinco casos en
`server/__tests__/projectPersistence.test.ts`. Usan el servidor HTTP local, sus
rutas autenticadas mediante nonce, carpetas temporales y el checkpoint en disco.
Cierran el servidor y crean otro coordinador y servidor sobre los mismos archivos.
Las peticiones de estos casos se realizan mediante Fastify inject; no son pruebas
de cierre y reapertura del proceso de escritorio.

El ejecutor de IA y la evidencia de suscripción son simulados. Las comprobaciones
de aceptación sí ejecutan Node realmente, leyendo un archivo del proyecto temporal.
Los contadores de consumo son datos de prueba, no mediciones de un modelo real.

| Caso                                   | Resultado observado                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarea preparada, cierre y recuperación | Conserva ID de tarea, carpeta canónica, petición, decisiones, aceptación e IDs de pruebas; queda en pausa, sin autorización ni elección activa. |
| Abrir el estado recuperado             | No consulta ni ejecuta modelos; renueva el nonce del control local.                                                                             |
| Comprobación satisfactoria             | Registra salida 0 y `passed: true`; conserva resultado y contadores después del cierre y recuperación.                                          |
| Comprobación fallida                   | Registra salida 7 y `passed: false`; bloquea con `local_checks_failed`. Al recuperar conserva los resultados y queda en pausa.                  |
| Comprobación retirada del catálogo     | La tarea recuperada se bloquea con `check_unconfigured` al intentar ejecutarla; no llama al modelo.                                             |
| Checkpoint corrupto                    | Informa `checkpoint_invalid`, rechaza reanudar y conserva el archivo corrupto.                                                                  |

La conservación del catálogo de pruebas en estos casos depende de reconstruir
explícitamente el mismo `LocalChecks` al arrancar. No demuestra la persistencia de
un registro de comandos ni la aprobación humana de esos comandos.

Además, las dos pruebas existentes de navegador `team.spec.ts` y
`team-workflows.spec.ts` pasaron con Edge y el paquete recién compilado. Comprueban
el panel React, HTTP, estados y recorridos de coordinación con ejecutores
simulados. No verifican que el formulario recuerde la carpeta al volver a abrirse.

## Qué falta para aceptar «proyecto registrado y recordado»

Estas carencias se identificaron por inspección del código; no se presentan como
capacidades verificadas mediante navegador:

- `TeamPanel.tsx` inicializa la carpeta con `useState('')` y su carga de estado no
  repone ese campo. `TeamScopeForm.tsx` también inicia vacío el contrato. Aunque
  las tarjetas recuperen las tareas, el formulario no recuerda el proyecto ni
  su contrato para el siguiente encargo.
- Los contratos HTTP y el checkpoint contienen tareas y flujos, no un registro
  independiente de proyectos con identidad y selección persistentes. La carpeta
  y las decisiones recordadas pertenecen a cada tarea; no son instrucciones
  generales versionadas de un proyecto registrado.
- El arranque en `server/src/cli.ts` reconstruye `pixelOfficeChecks(process.cwd())`.
  Este catálogo está ligado a la carpeta de arranque de la oficina y a sus scripts;
  no registra las comprobaciones aprobadas de cada proyecto elegido en el panel.
- `LocalCheckCommand.acceptance` y `criteria` expresan configuración y cobertura
  suministradas por código local. No existe en ese contrato una aprobación humana
  persistida con su identidad, versión y alcance. El catálogo público solo expone
  ID y condición de aceptación; no permite verificar dicha aprobación.
- La existencia de una prueba, su cobertura de criterios y su resultado son
  conceptos distintos. El catálogo de la oficina marca `test` como aceptación,
  pero no declara criterios concretos: no acredita por sí solo cualquier encargo
  nuevo ni permite eliminar automáticamente su revisión independiente.

Por tanto, queda pendiente implementar y comprobar el registro persistente por
proyecto, la recuperación del proyecto seleccionado y sus instrucciones, y la
aprobación explícita de las comprobaciones vinculada a su configuración. Después
debe probarse ese recorrido mediante el panel y tras reiniciar el proceso.

## Validación ejecutada

- Nueva prueba de persistencia: 5 casos aprobados.
- `npm run check-types`: aprobado.
- `npm run lint`: sin errores; una advertencia existente en `App.tsx` sobre la
  dependencia `editor` de un efecto de React.
- `npm test`: 59 pruebas de webview, 699 de servidor (incluidas las cinco nuevas)
  y 7 del contrato del paquete, todas aprobadas.
- `npm run package`: aprobado.
- `npx playwright test --config e2e/playwright.standalone.config.ts team.spec.ts team-workflows.spec.ts`:
  2 pruebas aprobadas.

Esta verificación añade pruebas y documentación. No cambia la implementación del
producto, no modifica el diseño y no ejecuta CLIs de inferencia ni pilotos reales.
