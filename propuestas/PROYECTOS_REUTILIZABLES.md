# Referencias para una oficina con Codex y Claude por CLI

Revisión: 20 de octubre de 2026.

## Alcance y resultado

Se han consultado repositorios públicos, documentación y archivos concretos de
código. No se han instalado ni ejecutado estos proyectos, conectado cuentas o
realizado llamadas a modelos. Esta revisión no certifica su funcionamiento en
nuestro ordenador ni el cumplimiento de todos nuestros requisitos.

La referencia funcional más cercana encontrada es Claw-Empire. La recomendación
es conservar Pixel Office como aplicación y motor visual, y adaptar selectivamente
patrones de coordinación existentes. No incorporar varios motores completos.

## Candidatos

| Proyecto                                                                          | Qué aporta                                                                                                                                         | Límite para nuestro caso                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Claw-Empire](https://github.com/GreenSheep01201/claw-empire)                     | Oficina animada, departamentos, responsables, tareas, reuniones, estados en tiempo real y lanzamiento de Codex/Claude mediante sus CLIs.           | Incluye rutas API/OAuth y acceso directo a credenciales. El lanzador revisado utiliza permisos amplios. No adoptarlo sin adaptar estas partes.                                                                                                                     |
| [Pixel Office de Basri Ayaz](https://github.com/basriayaz/pixel-office)           | Personajes personalizables, oficinas, conversación con empleados, memoria, tablero y responsable de proyecto. Codex mediante `codex exec`.         | Es otro proyecto con el mismo nombre. Claude usa Agent SDK, y admite proveedores por API. No cumple de entrada nuestra exigencia de Claude exclusivamente por su CLI.                                                                                              |
| [Hydra](https://github.com/jpdlr/hydra)                                           | Aplicación de escritorio para varias sesiones de Codex/Claude, adaptadores por proveedor, responsable mediante MCP y ejecuciones en segundo plano. | Su interfaz es de terminales y paneles. Los argumentos de ejecución deben contrastarse con los CLIs instalados; el adaptador Codex revisado usa `-q` en su ejecución no interactiva. Sus presupuestos documentados son avisos, no una garantía de pausa por cuota. |
| [GT Office](https://github.com/Laplace-bit/GT-Office)                             | Aplicación de escritorio, terminales oficiales, tareas y comunicación entre agentes.                                                               | Su arquitectura Rust/Tauri añade componentes que nuestra aplicación actual no necesita. Se revisaron documentación, estructura y licencia raíz; no sus adaptadores en profundidad.                                                                                 |
| [Office for Claude Agents](https://github.com/percheniy/office-for-claude-agents) | Oficina visual, seguimiento de sesiones y soporte básico de Codex.                                                                                 | Tiene licencias diferentes para código original y determinadas aportaciones; no tratar todo el repositorio como MIT. No es nuestra primera opción de reutilización.                                                                                                |

## Licencias observadas

- Claw-Empire: [Apache-2.0](https://github.com/GreenSheep01201/claw-empire/blob/66a24ea7df2435ef897c48c147deb7ec572c01c2/LICENSE).
- Basri Ayaz Pixel Office: [MIT](https://github.com/basriayaz/pixel-office/blob/4ebfdc7e4538eb68ea987f57ccf2810bc488a39c/LICENSE).
- Hydra: [MIT](https://github.com/jpdlr/hydra/blob/d8ad56112c2c3acfb2f65f53b6890f30a25c693c/LICENSE).
- GT Office: [Apache-2.0](https://github.com/Laplace-bit/GT-Office/blob/e4cc209bc8100916cf0b7d857860fa6e3762c4c3/LICENSE).
- Office for Claude Agents: [aviso de licencias por procedencia](https://github.com/percheniy/office-for-claude-agents/blob/8fc8759326335ac95b02b4da88164fc3d0054a3b/LICENSE).

La revisión de la licencia raíz no sustituye la revisión del archivo, recurso
gráfico, dependencia y avisos de atribución concretos antes de incorporarlos.

## Evidencias de implementación

### Claw-Empire

Revisión: `66a24ea7df2435ef897c48c147deb7ec572c01c2`.

- [Argumentos de los CLIs](https://github.com/GreenSheep01201/claw-empire/blob/66a24ea7df2435ef897c48c147deb7ec572c01c2/server/modules/workflow/core/cli-tools.ts):
  construye `codex exec --json` y `claude --print --output-format=stream-json`.
  Pasa modelo y razonamiento para Codex; el constructor Claude revisado no pasa
  razonamiento. Activa `--yolo` o `--dangerously-skip-permissions` en determinados
  recorridos. No trasladar esos valores por defecto.
- [Consulta de consumo](https://github.com/GreenSheep01201/claw-empire/blob/66a24ea7df2435ef897c48c147deb7ec572c01c2/server/modules/workflow/agents/providers/usage-cli-tools.ts):
  recibe funciones que leen tokens y llama directamente a endpoints con esos
  tokens. Es incompatible con nuestra prohibición de extraer credenciales.
- [Runtime de procesos](https://github.com/GreenSheep01201/claw-empire/blob/66a24ea7df2435ef897c48c147deb7ec572c01c2/server/modules/workflow/agents/cli-runtime.ts):
  hereda el entorno del proceso. Para nuestro uso debe mantenerse la separación
  de variables y configuración que impide rutas de facturación por API.

### Basri Ayaz Pixel Office

Revisión: `4ebfdc7e4538eb68ea987f57ccf2810bc488a39c`.

- [Codex](https://github.com/basriayaz/pixel-office/blob/4ebfdc7e4538eb68ea987f57ccf2810bc488a39c/src/server/codex.ts):
  proceso por turno y reanudación por identificador de conversación.
- [Proveedores](https://github.com/basriayaz/pixel-office/blob/4ebfdc7e4538eb68ea987f57ccf2810bc488a39c/src/server/providers.ts):
  catálogo y activación por proveedor, con rutas por API adicionales.
- [Documentación](https://github.com/basriayaz/pixel-office/blob/4ebfdc7e4538eb68ea987f57ccf2810bc488a39c/README.md):
  responsable de proyecto, tablero, memoria y reuniones. Las reuniones consumen
  un turno por participante y mensaje; no activar ese patrón por defecto dado
  nuestro objetivo de ahorrar cuota.

### Hydra

Revisión: `d8ad56112c2c3acfb2f65f53b6890f30a25c693c`.

- [Adaptadores](https://github.com/jpdlr/hydra/blob/d8ad56112c2c3acfb2f65f53b6890f30a25c693c/electron/agents/providers.ts):
  contrato común para preparar comandos y comprobar instalación.
- [Catálogo](https://github.com/jpdlr/hydra/blob/d8ad56112c2c3acfb2f65f53b6890f30a25c693c/electron/agents/ProviderModelCatalog.ts):
  incluye consulta de modelos mediante `model/list` de Codex.

## Aplicación propuesta a nuestra base

1. Conservar oficina, personajes, animaciones y editor de Pixel Office.
2. Mantener el ejecutor Codex existente y sus comprobaciones de suscripción.
3. Añadir un adaptador separado para el CLI oficial de Claude. Mientras falte
   sesión verificable o no se pueda descartar consumo adicional, seguirá apagado.
4. Añadir una cola común de tareas con responsable, dependencias, resultado,
   cancelación y pausa. Inspirarse en la separación de tareas y agentes de los
   candidatos; seleccionar archivos reutilizables durante la implementación.
5. El Jefe propone proveedor, modelo y razonamiento dentro del catálogo permitido.
   Una política determinista valida la propuesta antes de ejecutar. Auto será el
   valor inicial y se conservarán los modos manual y mixto aprobados.
6. Traducir los eventos reales de cada CLI a los estados visuales de los personajes.
7. Pausar al alcanzar límites o perder la verificación de la suscripción. Nunca
   cambiar a API, créditos adicionales ni otro mecanismo de pago.
8. Usar sólo los personajes necesarios por tarea y compartir contexto acotado.
   No importar reuniones automáticas ni revisiones repetidas por defecto.
9. Mantener Antigravity desactivado.

Esta propuesta no sustituye la base actual ni aprueba un diseño nuevo. Las dos
vistas ya seleccionadas se conservan como referencia visual.
