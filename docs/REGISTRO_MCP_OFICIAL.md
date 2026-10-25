# Conexiones HTTP administradas mediante Codex

El Jefe dispone de `connection_connect_codex`: recibe nombre y URL pública, o el
identificador de una conexión guardada. Agrupa el registro oficial, el inicio de
sesión cuando sea necesario y la comprobación del catálogo en una propuesta. La
tarjeta de autenticación existente muestra la página oficial del proveedor dentro
de Conversaciones. Las credenciales quedan bajo control del CLI; el cliente HTTP
anterior no las recibe ni copia. El recorrido OAuth está probado con simulaciones;
su aceptación con un proveedor y una persona reales sigue pendiente.

El registro local de conexiones conserva ahora explícitamente el motor elegido
(`sdk` o `codex`). El adaptador oficial comprueba el catálogo y ejecuta la operación
con una sesión técnica de App Server, sin iniciar inferencia del modelo.
Una conexión administrada con Codex no cambia al cliente HTTP si falta ese
adaptador. Tras reiniciar conserva su motor y requiere comprobación; intentar
conectarla con el cliente anterior tampoco reactiva un acceso desactivado.
Cada `connection_call` requiere su propia aprobación de destino, herramienta,
definición y argumentos. Un cambio de definición invalida la operación antes de
enviarla. Registrar o autenticar no presenta la conexión como lista: hace falta
una operación sin error. Desactivar cancela también un inicio de sesión pendiente.

Antes de contactar por el transporte nativo se comprueba el destino público. Se
rechazan redes privadas, redirecciones y denegaciones 403, sin buscar otro motor
para eludirlas. Esta comprobación previa no es una garantía sobre cada petición
posterior del transporte de Codex, que administra su propia conexión y OAuth.

## Contrato

`OfficialMcpRegistration` prepara una propuesta con servicio, dirección pública,
nombre generado y efectos. Preparar no escribe configuración. El adaptador del
ejecutor sólo admite el espacio de nombres `office-managed-` derivado de la URL;
no acepta comandos, campos de autenticación, claves de configuración o rutas del
disco elegidos por el modelo.

El CLI identifica la capa de usuario, su archivo y versión. Tras la aprobación
del controlador de Conversaciones, el registro revalida esa
versión y usa la operación oficial `config/value/write` con `expectedVersion`.
No sobrescribe un servidor existente ni otro archivo de configuración. Un cambio
de configuración desde la propuesta requiere una propuesta nueva. La dirección
se comprueba desde un cliente nuevo antes de declarar el registro confirmado.

Una entrada existente y compatible se reconoce sin volver a escribirla. Si una
escritura no se puede confirmar, el recibo conserva revisión obligatoria y no se
reintenta automáticamente. Registrar no autentica, no inicia un modelo ni acredita
herramientas utilizables. La validación de esta fase comprueba el formato HTTPS y
rechaza credenciales, parámetros y direcciones locales explícitas; no sustituye
la comprobación de red y proveedor del controlador de conexión.

La API y su control de versión están descritos en la
[documentación oficial de App Server](https://learn.chatgpt.com/docs/app-server).
Se comprobó también el esquema emitido por el CLI instalado, sin usar claves API.

## Evidencia

- Pruebas simuladas: preparación sin escritura, control de cambios, colisiones,
  reutilización sin escritura, cancelación, restricción de archivo y espacio de
  nombres, conservación del resultado incierto y ausencia de login o inferencia.
- Prueba real con CLI `0.163.0-alpha.11.2` y `CODEX_HOME` temporal, sin copiar
  credenciales. Se creó únicamente una dirección sintética `.invalid` en ese
  perfil, se verificó desde otro cliente, se conservaron el comentario y ajuste
  ajenos a la entrada y se reconoció el registro existente sin reescribirlo.
- También se verificó el primer uso con un perfil sin `config.toml` previo.
  El archivo lo creó el mecanismo oficial, sin edición manual del archivo real
  del usuario. No se conectó ni autenticó ningún proveedor externo.

La evidencia y perfiles temporales se conservan en el estado privado ignorado.
Esta prueba acredita registro de configuración, no el recorrido OAuth ni llamadas
a un MCP autenticado.

En una comprobación posterior con el CLI real se registró temporalmente
`https://developers.openai.com/mcp`, se cargó su catálogo mediante el adaptador
oficial y se completó exactamente una llamada a `search_openai_docs` con la
consulta `Codex App Server MCP`. Se comprobó la cuota incluida, sin iniciar un
turno del modelo. Después se retiró únicamente la entrada creada por la prueba
mediante `codex mcp remove` y se confirmó su ausencia desde un cliente nuevo.
El recibo privado registra `verified: true` y `cleanupVerified: true`. Este MCP
público no requiere iniciar sesión; su éxito no acredita el recorrido OAuth.

El registro de resultados inciertos incorpora ahora `mcp-registrations` a las
revisiones humanas de Herramientas y conexiones. La revisión se liga a la versión
original del recibo y no repite una escritura ni reanuda el encargo.

## Actualizar el catálogo después de autenticar

`connection_check`, con el identificador devuelto por `connections_list`, consulta
las herramientas de una conexión oficial ya registrada y habilitada. No registra
otra vez, no inicia OAuth, no ejecuta herramientas ni cambia de motor. También
sirve para recuperar el catálogo después de reiniciar. Comparte la exclusión de
operaciones activas y la cancelación del encargo; una conexión desactivada no
puede comprobarse. `connection_call` conserva la aprobación específica de cada
operación y la revalidación de su esquema. El estado sigue sin verificar hasta
comprobar una operación real.

Tras OAuth real de Vercel, una sesión de herramientas con papel Tester recuperó
238 herramientas y el esquema de `list_teams` usando esta comprobación. No hubo
inferencia, registro, OAuth adicional ni llamadas a herramientas del proveedor.
La evidencia privada está en `.local-office/vercel-catalogue-validation/`.
El equipo real todavía debe completar su consulta única de equipos y revisión;
no se sustituye esa aceptación con la lectura del catálogo.

El descubrimiento general también distingue estos servidores administrados de
MCP sin adaptador. Solo reconoce la entrada de motor Codex cuyo nombre coincide
con la dirección registrada y si el ejecutor ofrece el adaptador. Explica
`connection_check` y `connection_call`; no declara comprobada una operación ni
habilita conexiones desactivadas. Los servidores ajenos mantienen su bloqueo.

Las llamadas nuevas devuelven un recibo persistente y su aprobación vinculada.
Consulta [recibos de conexiones](RECIBOS_CONEXIONES.md) para distinguir cobertura
histórica, estados y recuperación. No se inventan recibos de llamadas anteriores.
