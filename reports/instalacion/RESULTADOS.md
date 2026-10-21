# Comprobación de la instalación

20 de octubre de 2026. Origen: `f8dbff7b308106774994f2ec9576783c71d62097`.

| Comprobación                                  | Resultado                                                          |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Instalación `npm ci`                          | Completada con el archivo de bloqueo original.                     |
| Compilación `npm run build`                   | Correcta: contrato, tipos, ESLint, servidor, extensión y frontend. |
| Pruebas de interfaz y motor                   | 52 aprobadas.                                                      |
| Pruebas de servidor                           | 430 aprobadas.                                                     |
| Contrato de empaquetado                       | 7 aprobadas.                                                       |
| Pruebas de navegador standalone               | 7 aprobadas en Microsoft Edge.                                     |
| Total de pruebas                              | 496 aprobadas.                                                     |
| Formato de los archivos de código modificados | Prettier correcto.                                                 |
| `git diff --check`                            | Correcto.                                                          |
| Cambios de diseño en `webview-ui/`            | Ninguno.                                                           |

Las pruebas de navegador existentes comprueban ciclo de vida de personajes, cierre de agentes, diagnósticos, carga de recursos externos, exportación, importación y reconexión. Se abrió también el editor original y se verificaron sus herramientas de mobiliario, suelo, paredes, mascotas y borrado, sin guardar un rediseño.

Se verificaron los archivos `ABRIR-OFICINA.cmd` y `CERRAR-OFICINA.cmd`, la apertura en `http://127.0.0.1:4173` y el estado del servidor tras reiniciar. Se observaron seis personajes disponibles, dos mascotas y 38 elementos de mobiliario cargados; estos son recursos disponibles, no agentes activos inventados.

Se observó un personaje de esta conversación real de Codex y sus eventos de herramienta. Esta prueba no ejecutó otra consulta a un modelo. La actualización depende de cuándo Codex escribe su sesión; puede no haber personajes durante una pausa o cuando el cliente no haya guardado actividad reciente.

Las nuevas comprobaciones cubren selección de proveedores, rechazo de valores inválidos, arranque solo con Codex sin configuración de Claude/Hermes, cambios del control de hooks, llamadas estructuradas y freeform, exclusión del contenido freeform, reanudación después de inactividad, restauración de identidad y exclusión de proveedores desactivados. Los archivos de prueba son temporales.

No se ha comprobado una cuenta real de Claude/Hermes, ni la batería completa de VS Code. No hay integración con Google Antigravity ni gestión automática de las dos suscripciones de Codex.

La compilación mantiene un aviso original de React Hooks en `App.tsx`. La instalación original tiene 20 avisos de `npm audit`; se conserva el detalle en `npm-audit-original.json`. Las licencias y los límites de procedencia de recursos se detallan en `docs/INSTALACION_LOCAL.md`.

La política automática bloqueó la limpieza opcional de archivos simulados fuera del proyecto; no bloqueó la instalación. No se ejecutaron borrados alternativos. No se hicieron commits, push ni cambios de rama.
