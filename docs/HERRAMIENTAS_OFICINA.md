# Herramientas de la oficina

Desde Conversaciones, **Herramientas y conexiones** muestra la última comprobación
de cada capacidad, su fecha y el motivo si falta algo. **Comprobar herramientas**
consulta los catálogos oficiales sin pedir trabajo a un modelo. Detectar una
conexión no demuestra que una operación funcione.

## Uso

- Adjunta, pega o arrastra PNG, JPEG o WebP: hasta diez imágenes de 20 MB cada una.
  El servidor decodifica la imagen completa y limita también sus dimensiones.
  El borrador, los mensajes, las capturas y los resultados guardan referencias
  privadas. Puedes abrirlos y descargarlos después de reiniciar.
- El modelo recibe los archivos reales. Las imágenes recientes del mismo chat
  acompañan las peticiones siguientes como referencias, dando prioridad a los
  adjuntos actuales, con un máximo conjunto de diez. No se comparten otros chats.
- La búsqueda nativa devuelve fuentes en la respuesta. El navegador usa un perfil
  propio de Edge y puede leer, capturar y comprobar escritorio y móvil. Para iniciar
  sesión abre una ventana propia: introduce tus credenciales allí, nunca en el chat.
- El Diseñador puede generar y modificar imágenes mediante la herramienta nativa
  de Codex. Los resultados se guardan fuera del código. Solo el Programador puede
  incorporarlos a la implementación; los cambios importantes de diseño conservan
  la aprobación creativa.
- Las acciones externas o de efectos desconocidos presentan su destino y datos
  para aprobación. Cada aprobación sirve una sola vez; detener o reiniciar la
  oficina invalida las pendientes. Los formularios sencillos admiten campos de
  texto, número, sí/no y opciones. Los secretos se introducen mediante la conexión
  oficial, no mediante esos formularios.

El motor predeterminado es **Codex App Server**, ejecutado por el CLI oficial con
sesión ChatGPT y cuota incluida. `office.config.json` permite seleccionar
explícitamente `codex-app-server`, el anterior `codex-cli` o `agent-orchestrator`.
Un fallo no cambia de motor. El motor anterior no acepta imágenes. Se comprueban
cuota, modelo, permisos efectivos y consumo; no hay claves API ni recargas.

Todos los papeles reciben el mismo catálogo. Disponer de una herramienta no
concede permiso para cualquier efecto: los lectores conservan la implementación
sin cambios y las operaciones externas mantienen su aprobación.
El MCP compartido ofrece `project_list` y `project_read` para inspeccionar el
proyecto, y `project_checks` y `project_check_run` para consultar y ejecutar las
comprobaciones registradas. Están disponibles también para el Tester. La lectura
usa rutas relativas y bloques sucesivos, sin truncar el archivo completo; no
permite escapar del proyecto ni consultar credenciales o historial privado.
Un proyecto sin pruebas registradas se identifica expresamente; no se inventan
comprobaciones ni se aceptan comandos arbitrarios mediante esta herramienta.

En Windows se prefiere MXC, con el fallback oficial elevado, conservando el
aislamiento. Las copias de la oficina antes alojadas en AppData se conservan y
se trasladan mediante una nueva copia a `~/CodexOfficeWorkspaces` al preparar el
siguiente trabajo autorizado. Mantienen su base, cambios y protección contra
conflictos. Un error 267 indica un directorio no válido para iniciar el proceso;
no demuestra que un empleado carezca de herramientas. La apertura del historial
no provoca esa preparación ni reanuda el trabajo.

Validación de esta corrección: pruebas de los cinco papeles con transporte MCP y
procesos locales reales, traslado de copias y conflictos, y lectura desde la nueva
ubicación con el sandbox oficial de Windows. Estas pruebas no consumen cuota y
no constituyen una nueva evaluación de visión, generación ni conexiones externas.

## Conexiones y límites actuales

La oficina incluye un [gestor MCP HTTP](ECOSISTEMA_AUTONOMO.md) invocable por los
empleados desde Conversaciones. Permite proponer, comprobar y usar conexiones
públicas compatibles con aprobaciones concretas dentro del chat. Las que necesitan
autenticación no compatible quedan identificadas; no se instalan plugins arbitrarios.

Las aplicaciones oficiales usan su autenticación existente y aprobación por
operación. Conecta o habilita la aplicación en Codex y vuelve a comprobar el
catálogo. Las skills disponibles se consultan completas cuando hacen falta.
Los plugins exclusivos del escritorio no se heredan automáticamente.

Los MCP instalados se pueden descubrir, pero el ejecutor deshabilita los que no
tienen un adaptador con controles de efectos. No se anuncia como operativa una
conexión únicamente por aparecer instalada. El MCP privado de la oficina es una
conexión propia por encargo, con token efímero y acceso desde el equipo local.
Sus llamadas llegan directamente al adaptador privado, que aplica las confirmaciones
externas. No requieren una segunda confirmación nativa para leer o capturar.
Las aplicaciones conectadas mantienen la confirmación nativa por operación.
La configuración utiliza los controles MCP de la
[documentación oficial](https://learn.chatgpt.com/docs/config-file/config-reference).
Una conexión previa llamada `office` bloquea el encargo antes de mezclar configuraciones.

El navegador bloquea los service workers y WebSocket: los mensajes de esos canales
podrían eludir la revisión de solicitudes. Una aplicación con recarga automática
puede necesitar recargarse manualmente. Las solicitudes de escritura desconocidas,
incluidas las de una aplicación local que podría actuar como intermediario, piden
aprobación. Una operación local solo se clasifica mediante evidencia del servidor,
nunca por una afirmación del modelo.

La vista previa se inicia mediante el sandbox oficial de Codex. En Windows bloquea
Internet pero permite todos los puertos locales, no solo el del proyecto. Su inicio
explica ese alcance y requiere aprobación. No existe una garantía de aislamiento
por puerto frente a otros servicios locales. Si falla el sandbox no se ejecuta el
proceso sin aislamiento.
Esta limitación también afecta a los comandos locales del modelo: las aprobaciones
del navegador y las aplicaciones conectadas no constituyen un cortafuegos universal
para cualquier programa local. No se anuncia esa garantía como comprobada.

El auxiliar de Windows no abre una consola. Verifica ventana, proceso y foco antes
de cada entrada, serializa el escritorio entre empleados y se detiene ante una
ventana desaparecida, pérdida de foco o cancelación. No obtiene permisos del sistema
ni fuerza la activación de otra ventana.

## Cuando el proyecto es esta oficina

Se copia el estado local actual, incluidos cambios sin confirmar, a una carpeta
privada. Se excluyen credenciales, historial privado, dependencias y archivos
generados. Las dependencias se instalan aparte sin ejecutar scripts de instalación.
La vista previa tiene otro puerto y estado privado; no instala observadores de
sesiones ni permite ejecutar modelos, incluido Claude.

El Tester revisa la copia. La integración verifica los bytes revisados y que los
originales no hayan cambiado. Los conflictos conservan ambas versiones. Un encargo
individual con cambios pendientes no se presenta como integrado: queda en revisión.
No se reinicia la oficina con trabajo activo ni se reanudan encargos al abrirla.

## Evidencia y comprobaciones (22 de octubre de 2026)

**Con modelos reales y cuota incluida:** lectura correcta de una imagen de prueba,
búsqueda web nativa con enlace, generación de un escritorio azul y edición de una
segunda versión verde. Se han inspeccionado ambas imágenes. Los recibos y archivos
de aceptación permanecen en el estado privado, fuera de Git.

**Programador y Tester reales:** se ha corregido un desbordamiento en una página
controlada usando el MCP de navegador, con capturas de móvil y escritorio.
El Tester rechazó primero un error de codificación, se corrigió en la misma copia
y una segunda revisión aceptó la entrega. El lector no cambió archivos y el
original permaneció intacto hasta integrar la captura revisada. Se conservan las
capturas, ambas revisiones y los recibos. Esta prueba controlada no sustituye la
aceptación de cambios sobre el proyecto completo de AGENTS SIMS.

**Conversación y oficina reales:** una petición natural sobre un proyecto de prueba
ha completado el circuito Jefe → Programador → Jefe → Tester → Jefe, con cinco
ejecuciones oficiales, ocho capturas, copia separada e integración final. La
conversación guardada contiene doce mensajes. La prueba empleó el coordinador y
la biblioteca reales; los recorridos por la interfaz se comprueban aparte con el
ejecutor simulado.
Al reconstruir la oficina de prueba se recuperaron los doce mensajes sin cambios,
las ocho imágenes y los cinco recibos de ejecución; no se inició ningún trabajo.

**Sin modelos:** protocolo y notificaciones, permisos, aprobaciones de un uso,
formularios, cancelación, validación de imágenes, almacenamiento, HTTP local,
referencias de imágenes entre mensajes, copia e integración con revisión obsoleta,
catálogo conservado tras reiniciar, navegador real con capturas y bloqueo de canales
no controlados. Las pruebas de conversación usan almacenamiento y navegador reales
con un ejecutor simulado; no equivalen a una inferencia completa desde la interfaz.

**Windows real:** enumeración e inspección, exclusión entre empleados, aprobación,
rechazo por pérdida de foco y parada. El ensayo del 23 de octubre no acreditó
escritura porque Windows no concedió el foco. El 25 de octubre sí se completó:
el auxiliar real escribió `office-verified` en la aplicación propia y pulsó
guardar; el test leyó el archivo y comprobó su contenido, además de rechazar
acciones después de detenerse. No se forzó el foco ni se usó inferencia.
Evidencia privada: `.local-office/final-windows-validation.log`.
Tampoco se ha realizado una publicación ni operación sobre una cuenta externa real.
El recorrido completo de mejora visual de AGENTS SIMS por Jefe, Programador y Tester
queda pendiente de aceptación real; las piezas de copia e integración sí se prueban
con archivos reales.

Comandos locales desde `pixel-office/`:

```powershell
npm run check-types
npm run lint
npm run package
npx vitest run --root server --maxWorkers=2 --testTimeout=30000
npm run test:webview
npm run test:standalone -- conversation-tools.spec.ts conversations.spec.ts
```

Las pruebas optativas `OFFICE_DESKTOP_INTEGRATION=1` y
`OFFICE_SANDBOX_INTEGRATION=1` ejecutan auxiliares y aplicaciones locales, sin IA.
Las pruebas con modelos nunca se activan automáticamente en CI.
