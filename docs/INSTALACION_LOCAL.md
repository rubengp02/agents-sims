# Instalación local y revisión inicial

Fecha de la revisión: 20 de octubre de 2026.

## Procedencia

- Copia local de https://github.com/josephndex/pixel-office.
- Commit de origen: `f8dbff7b308106774994f2ec9576783c71d62097`.
- Versión declarada: `1.4.0`; parte del nombre del paquete y sus metadatos siguen siendo los de Pixel Agents. Se conservan deliberadamente.
- Base anterior: https://github.com/pixel-agents-hq/pixel-agents.
- No se ha creado un repositorio público, ni se han hecho commits, push o cambios de rama.

## Arquitectura encontrada

Es una aplicación TypeScript/Node, no un proyecto Python. Las comprobaciones pertinentes son las de su propio paquete npm.

| Parte                   | Responsabilidad                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `core/`                 | Tipos, contrato de mensajes, modelos y herramientas de recursos visuales.                              |
| `server/`               | Servidor local Fastify, WebSocket, estado de agentes, almacenamiento e integraciones.                  |
| `webview-ui/`           | Interfaz React y oficina dibujada en Canvas: movimiento, animaciones, editor, muebles y mascotas.      |
| `adapters/vscode/`      | Integración original con VS Code y sus terminales.                                                     |
| `server/src/providers/` | Adaptadores para Claude, Codex y Hermes.                                                               |
| `bin/pixel-office`      | Lanzador original basado en herramientas de Linux. Se conserva; Windows usa el lanzador local añadido. |

La aplicación es principalmente un visualizador de actividad. El modo navegador no incorpora un gestor de cuentas ni un sistema para asignar tareas a varios modelos.

Claude usa sus hooks; Hermes usa su complemento de Python; Codex se observa leyendo sus archivos locales estructurados de sesión. Esta última integración depende del formato de esos archivos y puede requerir mantenimiento cuando Codex cambie. No se presenta como una API oficial estable de Codex.

Antigravity se habilita y selecciona explícitamente en Equipo. El ejecutor verifica
versión, catálogo, cuota y créditos adicionales desactivados; utiliza el puente de
herramientas de la oficina con permisos por empleado. Codex sigue como proveedor
predeterminado. Consulta [capacidades y límites comprobados](ANTIGRAVITY.md).

## Instalación y ajustes

Entorno comprobado: Windows, Node `24.19.0`, npm `11.17.0`, Codex CLI `0.154.0`.

Se instalaron las versiones del archivo de bloqueo mediante `npm ci`, y se compiló con `npm run build`. No se instalaron Claude ni Hermes ni se configuraron credenciales de modelos.

El archivo `office.config.json` contiene:

```json
{
  "port": 4173,
  "providers": ["codex"],
  "watchAllSessions": true
}
```

Para habilitar Claude más adelante, tras instalarlo y autenticarlo, se puede cambiar `providers` a `["claude", "codex"]` y reiniciar la oficina. Esto habilita la instalación original de hooks de Claude. No está habilitada ahora.

El arranque directo de la CLI sin `--providers` conserva las tres integraciones originales. Para trabajar solo con Codex debe usarse el lanzador o pasar `--providers codex`.

Los lanzadores `ABRIR-OFICINA.cmd` y `CERRAR-OFICINA.cmd` están en la carpeta superior. Usan `scripts/local-office.mjs`, sin instalar un servicio de Windows ni requerir privilegios de administrador. El servidor queda en segundo plano y solo escucha en `127.0.0.1`.

`watchAllSessions` se aplica al arrancar. El control correspondiente de Settings puede cambiarse durante la sesión. No es un filtro por cuenta: detecta sesiones del perfil local. Mantenerlo desactivado puede impedir que Codex se adopte porque los directorios rastreados del proyecto original corresponden al escáner de Claude.

El estado original, la oficina y las preferencias se guardan bajo `~/.pixel-agents/`. La actividad de Codex se lee desde `~/.codex/sessions/`; las credenciales no son necesarias para el visualizador. Los datos del lanzador y sus logs están en `.local-office/`, ignorado por Git. No deben publicarse los logs, pues pueden incluir rutas y estados locales.

## Correcciones necesarias sin rediseño

1. Selección explícita de proveedores con `--providers`. Los proveedores desactivados no instalan ni desinstalan hooks, y los eventos se siguen limitando a los proveedores activos.
2. Compatibilidad con `custom_tool_call` y `custom_tool_call_output` usados por el Codex instalado. El texto de esos scripts o parches no se envía a la interfaz: solo el nombre de la herramienta y su estado.
3. Las sesiones con un puente propio, como Codex, no pasan además por el lector de transcripciones de Claude, que producía diagnósticos falsos de formato. Se conserva la ruta para identidad y cierre.
4. Se conserva la identidad del proveedor al persistir y restaurar personajes. Un proveedor desactivado no se restaura. Los registros antiguos sin proveedor siguen interpretándose como Claude.
5. Corrección del aislamiento de pruebas en Windows: `os.homedir()` usa `USERPROFILE`, además del `HOME` usado por las pruebas originales. Se corrigieron también las comillas y separadores de comandos de la simulación.
6. Lanzadores locales para abrir, reutilizar una oficina activa y detener solo el proceso registrado cuyo PID coincida con la respuesta del servidor.
7. Reapertura de una sesión de Codex cuando vuelve a escribir después del cierre heurístico por inactividad, conservando su identidad y sin mostrar el contenido del script.

En la primera ejecución de los tests originales se detectó que su aislamiento incompleto había escrito preferencias de prueba en el perfil real de Pixel Agents, recién creado durante esta instalación. Se restablecieron las asignaciones de áreas generadas por esas pruebas; las siguientes ejecuciones usan hogares temporales.
La revisión automática bloqueó un comando de comprobación y limpieza opcional de carpetas de esa simulación bajo el perfil de Claude (`blocked by policy`). El listado previo mostró cuatro archivos simulados de 65 bytes en esas carpetas. Se conservaron, sin ejecutar borrados alternativos.

Los archivos de interfaz, sprites y oficina original no se han rediseñado.

## Validación

Los resultados definitivos se detallan en `reports/instalacion/RESULTADOS.md`. Los comandos reproducibles son:

```powershell
npm run build
npm test
npm run test:standalone
```

La compilación incluye generación del contrato, TypeScript, ESLint y el empaquetado. Se mantiene un aviso previo de React Hooks en `webview-ui/src/App.tsx`; no impide compilar.

Las pruebas de navegador se ejecutan en Edge en Windows y usan carpetas temporales. No requieren instalar ni iniciar sesión en Claude. El escenario de integración de los hooks está simulado y no equivale a una sesión real de Claude.

## Licencias y atribuciones

| Componente                           | Evidencia                                                                                                                                | Conclusión de la revisión                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código del repositorio               | `LICENSE`, MIT, copyright 2026 Pablo De Lucca; README del fork.                                                                          | Se permite modificar y reutilizar bajo sus condiciones; se conserva el aviso y la licencia.                                                                               |
| Personajes basados en MetroCity      | Atribución en `UPSTREAM_README.md`; https://jik-a-4.itch.io/metrocity-free-topdown-character-pack declara CC0.                           | Se conserva la atribución a JIK-A-4.                                                                                                                                      |
| Fuente FS Pixel Sans Unicode Regular | Metadatos del TTF y https://fontstruct.com/fontstructions/show/2606508/fs-pixel-sans-unicode-regular: Open Font License, NZWStudios2024. | Licencia separada de la del código. Antes de distribuir hay que acompañar la fuente con los avisos y el texto de licencia correspondientes; el original solo trae el TTF. |
| Mobiliario y mascotas incluidos      | Se conservan los archivos del proyecto; no se encontraron avisos individuales de licencia en las carpetas revisadas.                     | El repositorio declara MIT, pero esta revisión no certifica la procedencia individual de cada imagen.                                                                     |
| Dependencias npm                     | Cada paquete conserva su licencia en `node_modules`; archivo de bloqueo original.                                                        | No se presume que toda dependencia sea MIT.                                                                                                                               |

La mención a Donarg en `docs/external-assets.md` es un ejemplo de paquetes externos; por sí sola no demuestra la procedencia de cada mueble incluido. No se han comprado ni añadido recursos externos.

## Límites comprobados o pendientes

- Codex local: se observó esta conversación real y se comprobó la aparición de su personaje y eventos de actividad. La oficina no consume por sí misma otra consulta de modelo.
- La señal observada es lo que Codex guarda en disco. Si el cliente tarda en guardar eventos, la oficina también se retrasa; no es una medida del instante exacto de ejecución. En la última comprobación hubo una pausa suficiente para que la sesión dejase de considerarse reciente, por lo que una oficina vacía durante una pausa es compatible con este mecanismo.
- Claude y Hermes: código conservado y pruebas automáticas disponibles; no verificados con cuentas reales, porque no están instalados.
- No se ha ejecutado la batería completa de la extensión VS Code ni el caso de coexistencia VS Code/navegador. Las comprobaciones iniciales se centran en la aplicación local de navegador que se deja instalada.
- Codex usa una retirada heurística tras unos diez minutos sin datos; no es una señal exacta de que se haya cerrado el proceso. No hay garantía de representar todos los tipos de delegación, herramientas o futuros formatos de sesión.
- Cambiar de página o recargar recupera el estado del servidor. Después de un reinicio del servidor conviene recargar la página.
- El editor existente no permite editar visualmente todos los elementos de código, animaciones o integraciones. Es un objetivo futuro, sujeto a las decisiones de diseño del usuario.
- `npm audit` detectó 20 avisos en la instalación original: 12 moderados, 7 altos y 1 crítico. La instantánea está en `reports/instalacion/npm-audit-original.json`. No se ha ejecutado una actualización automática de dependencias que pueda alterar el comportamiento; esta instalación local no se presenta como preparada para publicación o distribución comercial.
