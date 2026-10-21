# Integridad de candidatos al recuperar checkpoints

## Evidencia y alcance

Se reprodujo localmente una aceptación obsoleta: un flujo completado con
trabajadores simulados y pruebas sobre un worktree Git real se guardó como
`accepted`. Tras modificar un archivo del candidato o eliminar su carpeta, un
coordinador nuevo con un gestor nuevo seguía restaurándolo como `accepted`.
Los dos casos fallaron antes de corregir el código (2/2, 10,28 segundos).
Esto acredita un defecto de integridad del estado recuperado; no demuestra
ejecución indebida, acceso a credenciales ni una vía de explotación.

La causa era la copia de `accepted` desde el checkpoint sin una verificación
vigente. `verifyIntegrated()` exige acreditaciones internas del gestor que no
se recuperan al reiniciar. Una ruta y una huella guardadas no las sustituyen.

## Corrección

Todos los flujos restaurados pasan a `paused` con
`workflow_recovery_required`, incluso los previamente aceptados y aparentemente
intactos. Se mantienen candidato, huella, resultados de pruebas, tareas,
asignaciones y contadores como evidencia histórica. No se crean worktrees,
repiten inferencias, reinician presupuestos ni aceptan resultados automáticamente.
El arranque y la reanudación quedan bloqueados por los controles existentes.

Esta corrección protege la restauración. No añade supervisión continua del
disco ni un mecanismo de recuperación de acreditaciones o reaceptación automática.

## Validación posterior

- 75/75 pruebas de `parallelWorkflow`, `teamCoordinator` y `teamRoutes`,
  en 54,31 segundos. Incluyen modificación, eliminación y candidato intacto
  al recuperar, conservación de consumo, bloqueo del arranque y ausencia de
  nuevas llamadas. Los dos casos nuevos también comprueban el estado persistido
  y que la recuperación no repare ni recree el candidato.
- `npm run check-types`: correcto.
- `npm run lint`: sin errores; conserva la advertencia previa de dependencia
  `editor` en `webview-ui/src/App.tsx`.
- `git diff --check`: correcto.

Sin modelos reales, consumo de suscripción, cambios visuales ni modificación de
informes históricos.
