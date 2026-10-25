# Inicio de sesión oficial dentro de Conversaciones

Los empleados consultan `auth_servers` para conocer los servidores registrados
en Codex y su método de autenticación. `auth_connect` recibe un identificador
del catálogo, no nombres, URL, scopes ni credenciales elegidos por el modelo.
Para un servidor sin sesión y compatible con OAuth, muestra una propuesta de
inicio de sesión; aprobada esa propuesta, el CLI oficial crea la autorización.

Conversaciones muestra el dominio y enlace del proveedor, con apertura manual
en otra pestaña y opción de cancelar. El usuario introduce sus credenciales en
el proveedor. La oficina no automatiza el formulario ni almacena contraseñas,
tokens, códigos ni el enlace de autorización. El enlace solo vive en la memoria
del proceso y en el estado transitorio enviado a la interfaz.

El proceso oficial permanece vivo durante el intento. La notificación debe
coincidir en servidor y `loginId`, incluso si llega antes que la respuesta de
inicio. Antes de confirmar se consulta otra vez el estado OAuth. La notificación
por sí sola no acredita éxito ni herramientas operativas. Tras OAuth es necesaria
una operación verificable para declarar lista una capacidad.

Detener el empleado, cancelar desde la tarjeta, perder el proceso oficial o
caducar el intento termina la espera. Las respuestas tardías no reactivan la
tarea. Reiniciar conserva solo el recibo público, marca los intentos inconclusos
como cancelados y no restaura enlaces ni aprobaciones. No se permite iniciar
dos autorizaciones simultáneas para un mismo servidor.

Cancelar localmente detiene la espera y el proceso; no garantiza revocar una
autorización que el proveedor ya haya aceptado. La revocación de permisos de
cuenta sigue siendo una operación distinta; no se acredita con una cancelación.

Terminar un turno del modelo no significa que hayan terminado las herramientas
que lanzó en segundo plano. El ejecutor espera la cola del servidor antes de
cerrar su proceso o devolver el control al siguiente empleado. Esa espera conserva
las aprobaciones y OAuth pendientes; una parada explícita sigue cancelándolos.
Si el transporte se cierra al mismo tiempo que una parada, el recibo conserva
«cancelado», en vez de atribuir el cierre a un fallo desconocido de conexión.

La prueba real de Vercel mostró este problema: el Jefe dio por terminado su turno
con la conexión pendiente y el cierre de recursos interrumpió OAuth antes de
confirmar la cuenta. Se conserva ese intento fallido, el registro del servidor y
la pregunta concreta para que el usuario decida un nuevo intento. No hubo consulta
de equipos. La corrección de espera y cancelación está comprobada con simulaciones;
el nuevo inicio de sesión real sigue pendiente de autorización humana.

## Cerrar una sesión OAuth local

`auth_disconnect` propone cerrar la sesión guardada del servidor OAuth concreto
identificado por `auth_servers`. La aprobación advierte que la sesión es compartida
con otros clientes Codex y que no garantiza revocar permisos en el proveedor ni
detener clientes externos ya conectados. No cierra la cuenta de ChatGPT ni elimina
el servidor. No admite el puente `codex_apps` con `bearerToken`.

El adaptador revalida el servidor y ejecuta exclusivamente `codex mcp logout --
<nombre>` con argumentos separados, sin shell ni consola. El proceso oficial
administra sus credenciales; la oficina descarta su salida. Después abre otro
cliente oficial para comprobar `notLoggedIn`. Un código de salida cero por sí
solo no acredita el cierre. La documentación oficial define este comando como
[retirada de credenciales OAuth guardadas](https://learn.chatgpt.com/docs/developer-commands#codex-mcp),
no como revocación remota de permisos.

Los recibos se consultan con `auth_operations` y conservan el destino y resultado
sin credenciales. Cancelar, perder el proceso o reiniciar después del envío deja
el cierre pendiente de revisión y bloquea su repetición. `auth_disconnect_check`
comprueba el estado actual usando el identificador del recibo; sólo acredita el
cierre si Codex informa `notLoggedIn`. No reenvía el comando. Si sigue habiendo
sesión, conserva la incertidumbre.

Validación: ayuda real del CLI instalado para `mcp logout`; pruebas simuladas del
proceso, aprobación, persistencia, cancelación previa, rechazo de servidores
incompatibles, revalidación y recuperación sin reenvío. No se ha cerrado ninguna
sesión real ni se ha revocado un permiso real durante estas pruebas.

## Evidencia y límites

Pruebas simuladas del protocolo: aprobación, correlación, notificación temprana,
estado posterior, desconexión, cancelación, caducidad, duplicados, persistencia
sin enlaces y recuperación. Pruebas de interfaz para visibilidad de enlaces,
destino, cancelación y ausencia de campos de credenciales. Ruta local protegida
por origen y token del servidor.

Comprobación real de metadatos: el ejecutor informa `codex_apps: bearerToken` y
`node_repl: unsupported`. No corresponde forzar OAuth sobre ellos. No se han
leído ni copiado los tokens de esas conexiones. El caso GitHub necesita resolver
el acceso operativo al puente existente o el mecanismo oficial que lo expone;
la [validación posterior](VALIDACION_CONVERSACION_GITHUB.md) acredita una consulta
GitHub de solo lectura desde un empleado real y su conversación persistida.

El flujo OAuth de este documento corresponde a servidores MCP registrados en
Codex. Las conexiones HTTP propias utilizan el
[registro y adaptador oficiales](REGISTRO_MCP_OFICIAL.md). Las aplicaciones
alojadas tienen un [recorrido distinto](APLICACIONES_ALOJADAS.md): página oficial,
intervención humana y comprobación posterior del runtime. Una aplicación ya
conectada no necesita repetir el inicio de sesión. Ninguno de esos estados
acredita por sí solo una operación ni una revocación de permisos en el proveedor.

El 23 de octubre de 2026 se preparó una prueba real del cierre local de Vercel,
comprobando antes `oAuth` mediante el cliente oficial, sin realizar cambios. La
persona eligió **Conservar Vercel conectado**. No se ejecutará ese cierre ni se
volverá a solicitar esa misma prueba sin una nueva indicación. Su validación real
queda no realizada por decisión humana; no constituye un fallo de OAuth.

La inspección de las 238 herramientas anunciadas por Vercel no identificó una
operación de revocación de esta autorización OAuth. Las operaciones de tokens
Global Config o claves KMS corresponden a otros recursos y no se ejecutaron.
La [API de autorización documentada de Vercel](https://vercel.com/docs/sign-in-with-vercel/authorization-server-api)
describe revocación mediante tokens y credenciales del cliente; esa ruta no se
implementa leyendo credenciales administradas por Codex. No se acredita revocación
remota mediante el cierre local ni mediante la búsqueda de herramientas.
