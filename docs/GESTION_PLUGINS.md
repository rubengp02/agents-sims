# Gestión oficial de plugins desde la oficina

La gestión usa App Server del CLI oficial, sin ejecutar comandos de instalación
proporcionados por un modelo ni leer credenciales. El cliente de gestión habilita
el catálogo de plugins; los clientes de ejecución conservan sus controles y hooks
desactivados. Esto no habilita automáticamente las herramientas de cada plugin.

## Herramientas compartidas

- `plugins_list`: búsqueda por nombre o marketplace, páginas con total y siguiente
  desplazamiento. No se envía el catálogo entero al contexto del empleado.
- `plugin_install` y `plugin_uninstall`: seleccionan un identificador del catálogo,
  consultan su detalle y preparan una propuesta dentro de Conversaciones.
- `plugin_operations`: recupera recibos sin ejecutar operaciones.
- `plugin_capabilities`: consulta las skills y los MCP declarados de un plugin.
  Los MCP declarados siguen sin comprobar hasta disponer de un adaptador probado.
- `plugin_skill_read`: carga el texto completo de una skill instalada y habilitada,
  identificada por el catálogo; devuelve su huella y la procedencia comprobada.
- `plugin_skill_resource`: enumera o lee referencias relativas a esa skill, por
  bloques de hasta 65.536 bytes y con indicación de final de archivo.

El identificador de la oficina incluye el origen para distinguir identidades
nativas repetidas en varios marketplaces. El servidor conserva las rutas
necesarias; el modelo no las puede elegir. Conflictos de datos para una misma
identidad y origen se muestran como pendientes de revisión y bloquean su cambio.

En una instalación remota, el campo RPC `pluginName` recibe el `remotePluginId`
anunciado por Codex. La retirada remota también envía ese identificador en
`pluginId`; la retirada local conserva su identidad local. Es la semántica de la
[implementación oficial de App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/plugins.rs).
La consulta de detalles y el identificador estable de la oficina se conservan;
no se cambian las referencias del historial. Si falta la identidad remota, se
bloquea la propuesta antes de pedir aprobación. Si cambia después, se invalida
antes del envío. La comprobación posterior también vincula esa identidad.

## Aprobación y recuperación

La propuesta muestra origen, versión, entradas relacionadas, MCP, skills, hooks,
tareas programadas y efectos de incorporación o retirada. Antes de ejecutar se
comprueban de nuevo catálogo y detalle; si cambiaron, hace falta una propuesta
nueva. La aprobación no se reutiliza.

Las mutaciones se serializan. El recibo se escribe como `dispatching` antes de la
llamada oficial. Después se consulta el catálogo; instalar exige confirmar estado
y procedencia. Retirar exige confirmar ausencia o estado no instalado. Un fallo
después del envío queda en revisión; no se repite ni revierte automáticamente.
Reiniciar conserva recibos y no restaura aprobaciones. Una retirada posterior
necesita su propia propuesta; no revoca por sí sola las cuentas externas.

## Lectura de skills

Todos los papeles pueden solicitar las instrucciones sin permiso de escritura.
La lectura no ejecuta scripts, hooks, MCP ni un modelo. Tampoco modifica el plugin.
Sus instrucciones conservan el alcance, los permisos por función y las aprobaciones
externas de la oficina. No habilitan servicios de IA de pago alternativos.

Cuando el catálogo remoto ofrece la skill sin una ruta local, la oficina obtiene
su texto principal completo mediante `plugin/skill/read`, con la identidad remota
y el nombre anunciados. Comprueba de nuevo el paquete después de la lectura y
devuelve origen, huella y finalización. Una respuesta vacía o sin contenido no
acredita la lectura. `resourcesAvailable` indica si existen archivos relativos
consultables: este RPC remoto sólo entrega el texto principal; sus referencias
no se convierten en rutas del disco inventadas.

El servidor selecciona los archivos desde los identificadores y metadatos oficiales;
el cliente no puede suministrar una ruta del disco. El archivo debe estar en la
caché del mismo marketplace y plugin, o en la carpeta oficial de plugins incluidos
que Codex declara bajo `.tmp/bundled-marketplaces`. El resultado distingue ambos
orígenes. No admite otras carpetas temporales. Las referencias quedan dentro de la carpeta
de la skill; se rechazan archivos sensibles, rutas ascendentes y enlaces a otros
paquetes. Antes de entregar el contenido se comprueba que el plugin no ha cambiado
de versión, origen o configuración durante la lectura. La skill principal se lee
completa, sin truncarla. Los archivos remotos sin copia local siguen pendientes de
un adaptador compatible.

Pruebas locales: texto completo con Unicode y más de 65.536 bytes, referencias,
lectura por el Tester sin escritura, archivos sensibles, IDs inventados, skills
deshabilitadas, cambios durante la lectura, cancelación y raíz del paquete
redirigida mediante un enlace. No equivalen a probar los MCP de un plugin.

Comprobación real: lectura completa de `computer-use:computer-use`, plugin
`computer-use` versión `26.1013.40934` de `openai-bundled`, desde la ubicación
oficial declarada por Codex. Se recuperaron 1.497 caracteres y se conservaron
huellas de contenido y procedencia en el estado privado. No se ejecutaron la
skill, sus herramientas ni un modelo; no se instaló ni retiró ningún plugin.

## Evidencia disponible

Pruebas simuladas de RPC y aprobaciones, cambios de versión, rechazo de IDs,
catálogos incompletos, duplicados, cancelación, resultado incierto persistente y
retirada de un plugin que desaparece del catálogo.

Consulta real de metadatos: el catálogo oficial devolvió 7.733 entradas y siete
conflictos. GitHub aparece instalado y habilitado en `openai-curated-remote`,
versión `0.1.12-5f7cd798dc99`. Esa consulta no instaló ni retiró paquetes.

Prueba real posterior: ciclo `plugin/list` → `plugin/install` → comprobación →
recuperación de recibo → `plugin/uninstall` → comprobación. CLI oficial y plugin
local `office-validation`, con una skill y sin MCP, hooks ni tareas programadas.
Se usó un `CODEX_HOME` nuevo y separado, sin copiar credenciales ni iniciar un
modelo. Las dos aprobaciones se resolvieron mediante un validador del piloto
autorizado que sólo admitía ese nombre, marketplace y ausencia de código activo;
no fue una interacción humana con la interfaz. La instalación y retirada fueron
reales, no RPC simuladas. Los plugins habituales quedaron fuera de esa configuración.
Los recibos y el resultado se conservan en el estado privado de validación.

Esta prueba no acredita instalación desde un servicio remoto ni autenticación.
Tampoco prueba aún el manejo visual de sus propuestas en Conversaciones.

La [validación posterior](VALIDACION_CONVERSACION_GITHUB.md) acredita una llamada
real de GitHub desde un empleado; el endpoint de aplicaciones sigue teniendo el
bloqueo 403 documentado. La lectura de skills tampoco acredita MCP locales operativos.
El objetivo del ecosistema permanece activo.
