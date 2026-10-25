# Estado verificable del ecosistema

## Entrega aceptada y objetivo cerrado

El 25 de octubre el usuario consideró completado el objetivo después de conocer
la limitación de revocación remota. Se cierra la entrega con las capacidades
oficiales comprobadas y esa limitación registrada. El cierre OAuth local y la
desactivación de Vercel sí están verificados; no se afirma que se haya revocado
el permiso en los servidores del proveedor. Véase la aceptación y alcance de
cierre en [Objetivo del ecosistema](OBJETIVO_ECOSISTEMA.md).

Las notas siguientes describen los estados anteriores y no reabren requisitos
que el usuario ha aceptado como limitaciones de esta entrega.

## Estado posterior: desconexión solicitada por el usuario

El 25 de octubre el usuario pidió desconectar Vercel. Se corrigió la omisión de
`logout` en el adaptador de autenticación registrada, con validación de nombre y
URL antes de delegar al CLI oficial. 66 pruebas aprobadas; tipos, lint y paquete
correctos. La prueba real pasó de `oAuth` a `notLoggedIn` desde un cliente nuevo,
con recibo `signed_out`; el intento previo fallido no llegó al cierre y permanece
registrado. La conexión local está deshabilitada. No se leyeron credenciales,
no hubo inferencia ni cambios en proyectos remotos. La versión corregida está
aplicada y el reinicio conservó exactamente las diez conversaciones y 135 mensajes.

Esto reemplaza la preferencia anterior de conservar la conexión activa para
esta prueba. No se afirma revocación remota de la autorización en Vercel ni cierre
de clientes externos ya conectados. Ese requisito continúa sin acreditar; no se
declara terminado el objetivo. Evidencia privada en
`.local-office/vercel-signout-real/evidence.json`. Las notas siguientes describen
estados y decisiones anteriores.

## Actualización aplicada del 25 de octubre: actividad y bucle de Vercel

La versión local ya carga los detalles de actividad y la corrección del botón
«Ya he conectado». Una comprobación oficial sin herramientas termina el intento
alojado como no disponible para Codex, sin pedir otra conexión ni desconectar
la cuenta. Los intentos anteriores se conservan plegados. Se aprobaron 30 pruebas
de servidor y nueve de interfaz relacionadas; el paquete pasó tipos y lint.

La instancia anterior volvió a abrir una espera alojada. Se detuvo de forma
controlada mediante el cierre del coordinador, luego se reinició el servidor ya
inactivo. No se reanudó trabajo: cero tareas activas, cero inicios de sesión
pendientes y Vercel MCP habilitado. No se realizó logout ni revocación.

Persistencia: seis conversaciones, 96 mensajes; las cinco originales y sus 80
mensajes conservan exactamente su hash. El hash completo previo al reinicio no
coincide con el posterior. El respaldo disponible y el archivo actual sólo
difieren en `reasonCode` de dos mensajes del último Jefe, pero ese respaldo tampoco
coincide con el snapshot inicial. No se presenta como prueba de identidad byte a
byte de todos los mensajes recientes. Los datos y el análisis se conservan en
`.local-office/auth-update-audit.json`; los snapshots futuros guardan también los
mensajes completos para permitir una comparación exacta de contenido y metadatos.

El objetivo sigue pendiente de aceptación visual del usuario y de la revocación
en un proveedor con una conexión prescindible. Conservar Vercel conectado y no
tener acceso al formulario oficial de revocación impiden acreditar ese último
paso aquí; no se sustituye por un cierre local ni por una simulación.

## Validación del 25 de octubre: avance y pasos del usuario

La escritura real de Windows ya está comprobada. La prueba optativa del auxiliar
nativo introdujo y guardó `office-verified` en una aplicación propia, leyó el
archivo y verificó el rechazo de acciones tras detenerse, sin forzar el foco.
Esto sustituye el pendiente anterior; no garantiza todas las aplicaciones.

La suite web pasó sus 93 pruebas. La ejecución amplia del servidor obtuvo 1095
aprobadas, dos omitidas y dos fallos por timeout de 10 segundos; al repetir
aisladamente la suite afectada, sus 19 pruebas pasaron sin cambiar sus tiempos
ni los controles del producto. Una nueva ejecución completa con dos procesos
simultáneos terminó sin fallos: 1097 aprobadas y dos omitidas, 86 suites aprobadas
y una omitida en 110,54 segundos. El log `final-server-confirmation.log` conserva
esta confirmación; el fallo previo permanece en su log original.
El empaquetado, tipos y lint finalizaron con éxito, con los avisos existentes de
dependencia `editor` y tamaño del bundle.

Las tres pruebas de navegador pasaron juntas (41,4 segundos), con almacenamiento
real y empleados simulados. Validan
conversaciones, imágenes, cola, redirección y recuperación. Se corrigió el guion
del Jefe simulado para vincular sus decisiones a `objectiveSessionKey` y no al
texto de revisiones de otros objetivos. El servidor rechazaba correctamente su
cierre obsoleto; no se relajó esa protección. Esta validación no sustituye una
inferencia nueva desde la instancia del usuario ni su aceptación visual.

Historial real conservado: seis conversaciones y 92 mensajes, con las cinco
conversaciones originales y sus 80 mensajes intactos. No hubo reinicio ni
reanudades automáticas. Vercel MCP se conserva operativo; el canal alojado queda
declarado no disponible en el ejecutor, sin bloquear la vía MCP comprobada.
Quedan la aceptación del recorrido en la instancia real y la revocación remota
con una conexión prescindible, respetando conservar Vercel. Los pasos están en
[Validación del usuario](VALIDACION_USUARIO.md).

Los logs privados `final-validation-tests.log`, `final-parallel-recheck.log`,
`final-validation-package.log`, `final-windows-validation.log` y
`final-browser-confirmation.log` conservan los resultados de esta entrega en
`.local-office/`. Las notas siguientes son históricas.

La auditoría posterior `audit-goal-current.mjs` coteja el recibo original de
Vercel con su huella, los registros reales Jefe → Tester → Jefe de GitHub,
el hash completo de mensajes y el de las cinco conversaciones anteriores,
la escritura real de Windows y las tres pruebas de navegador. Los ocho controles
pasaron; la oficina está inactiva y Vercel sigue habilitado. El resultado privado
`goal-current-audit.json` conserva `completionProven: false`: ni estos controles
ni las pruebas verdes sustituyen la aceptación del usuario o la revocación en
el proveedor. No se ha reiniciado la oficina ni cambiado sus datos en esta auditoría.

Validación adicional del 25 de octubre de 2026: 86 pruebas locales aprobadas
en siete suites de aplicaciones, autenticación, persistencia, plugins,
integraciones, conexiones y revisión de recibos. Son pruebas simuladas.
Separadamente, una sesión real del adaptador de herramientas de la oficina
comprobó el catálogo de 238 herramientas del MCP oficial de Vercel y ejecutó
exactamente una consulta `list_teams` con argumentos vacíos, tras revisar su
aprobación concreta bajo la autorización del usuario. El recibo terminó como
`completed`, sin inferencia, nuevo OAuth ni modificaciones remotas. Evidencia
privada: `.local-office/vercel-read-validation/874f9f86-2c76-4784-93f5-e878d361ca02/read-evidence.json`.
Esta prueba ejercita el adaptador real; no es un nuevo turno de un empleado ni
acredita el canal de aplicación alojada. Seis conversaciones y 92 mensajes
conservados; las cinco originales y sus 80 mensajes siguen intactos.

Comprobación del canal alojado del 24 de octubre de 2026. El usuario
ha indicado que completó el paso de Vercel. La comprobación oficial posterior
confirma el plugin instalado y habilitado, pero el runtime actualizado todavía
no incluye su aplicación ni acredita herramientas utilizables. Debe aclararse
esta diferencia antes de repetir el inicio de sesión o probar una operación;
no se atribuye automáticamente a un fallo del usuario.
La comprobación visual queda aplazada por indicación del usuario: no se elude el
bloqueo de Work. Se conserva Vercel MCP conectado y no se fuerza el foco de Windows.

| Parte del objetivo          | Estado y evidencia                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descubrimiento              | Catálogos oficiales, búsqueda y páginas, sin presentar declaración como conexión comprobada.                                                                                                                                                                                                                                                                                                                                                                           |
| Instalación y retirada      | Implementadas y comprobadas con paquetes locales y con el paquete remoto oficial Vercel 0.54.1: instalación verificada, lectura real de una skill y retirada remota verificada. Corregidas las identidades de instalación y retirada remotas; los intentos fallidos anteriores y sus revisiones técnicas se conservan.                                                                                                                                                 |
| GitHub                      | Consulta de solo lectura mediante el puente oficial, con modelos reales y conversación persistida. También completado Jefe → Tester → Jefe: sesión del Jefe conservada, Tester independiente de solo lectura, una operación autorizada y ocho mensajes recuperados. `app/list` conserva el 403 diagnosticado; no se eludió.                                                                                                                                            |
| Skills                      | Lectura completa bajo demanda: archivos locales y referencias protegidas, o texto principal mediante el RPC oficial remoto. `resourcesAvailable` distingue los archivos consultables; no se inventan rutas para referencias remotas. Lecturas reales de `computer-use` local y de `cdn-caching` remota, esta última con 21.014 caracteres, sin ejecutar sus instrucciones.                                                                                             |
| MCP de plugins              | Adaptador para un plugin seleccionado, hooks y demás plugins desactivados en ese contexto, herramientas verificadas por `pluginId`, aprobación por operación, cierre y recibos. Prueba real de exactamente una llamada de eco y retirada del paquete.                                                                                                                                                                                                                  |
| Permisos de empleados       | Herramientas de proyecto y adaptadores compartidos. Los MCP nativos de efectos desconocidos corresponden al Programador con escritura; no se atribuyen permisos de implementación a lectores.                                                                                                                                                                                                                                                                          |
| Windows                     | Auxiliar nativo comprobado con una aplicación propia: inspección, exclusión, aprobación exacta, pérdida de foco y parada. Escritura y guardado reales verificados el 25 de octubre, sin forzar el foco.                                                                                                                                                                                                                                                                |
| OAuth registrado en Codex   | Inicio de sesión real de Vercel completado desde Conversaciones: Codex confirma OAuth, el Tester consulta equipos y el Jefe acepta el resultado. No se leyeron ni copiaron credenciales.                                                                                                                                                                                                                                                                               |
| Conexiones HTTP propias     | Registro, motor explícito Codex y llamadas con aprobación propia. Consulta real al MCP público de OpenAI, con registro temporal retirado. Vercel: OAuth, catálogo de 238 herramientas y consulta list_teams del Tester completados; aceptación del Jefe. Las llamadas nuevas guardan recibos individuales con aprobación y huellas; el registro declara su cobertura y no reconstruye aquella consulta antigua.                                                        |
| Aplicaciones alojadas       | Directorio y runtime instalado independientes; página oficial, aprobación y comprobación manual, cancelación y recuperación implementadas. GitHub instalado y callable comprobado realmente. El Jefe real instaló Vercel y preparó su inicio de sesión alojado; la espera caducó sin acreditarlo. Corregida la pausa del coordinador para evitar revisiones repetidas ante esa dependencia humana. Sigue pendiente autenticar y comprobar una operación de este canal. |
| Cancelación y cierre        | Procesos propios cancelables, conexión del plugin limitada al empleado y sin restauración automática. Pruebas simuladas de fallos; cierre normal real comprobado sin procesos del MCP de prueba restantes.                                                                                                                                                                                                                                                             |
| Revocación                  | Desactivación local HTTP y cierre OAuth local mediante CLI implementados; revocar permisos en el proveedor sigue pendiente. No se anuncia como equivalente a desactivar acceso.                                                                                                                                                                                                                                                                                        |
| Persistencia y recuperación | Chats y artefactos preservados; recibos inciertos bloquean repeticiones. Revisión humana desde la interfaz para plugins, MCP, integraciones y cierre OAuth, ligada a los datos originales y sin reejecución. HTTP conserva su control previo. Pendiente aceptación visual del recorrido.                                                                                                                                                                               |
| Interfaz completa           | API y conversación real verificadas. La validación visual y el recorrido humano de decisiones y autenticación siguen pendientes.                                                                                                                                                                                                                                                                                                                                       |

Comprobación del 24 de octubre: `plugin_management` reconoce el paquete Vercel
instalado y habilitado. `plugin/read` anuncia la aplicación correcta y
`app/read` con herramientas devuelve sus descripciones, pero
`app/installed` con `forceRefresh: true` devuelve ocho aplicaciones, sin Vercel.
Un catálogo de herramientas no acredita autenticación ni una operación. La
evidencia privada está en `.local-office/vercel-runtime-diagnostic.json` y
`.local-office/hosted-vercel-current.json`. La auditoría conserva las seis
conversaciones y 92 mensajes; las cinco conversaciones originales y sus 80
mensajes permanecen intactos. No se inició otra autenticación ni se ejecutó una
operación alojada.

## Siguientes trabajos

1. Validar visualmente los controles de revisión y recuperación cuando el usuario
   decida retomar esa comprobación, sin repetir operaciones ni reutilizar aprobaciones.
2. Comprobar la revocación remota con una conexión prescindible, conservando Vercel.
   El protocolo actual no acredita revocación remota: `app_manage` ofrece la página
   oficial y explica esa limitación sin sustituirla por un cierre local. La segunda
   vía alojada de Vercel no bloquea su conexión MCP ya comprobada.
3. Validar el recorrido completo que quede pendiente. Mantener separadas las pruebas
   simuladas, los MCP reales sin modelo y las pruebas con empleado y modelo reales.
   La escritura de Windows ya se acreditó; falta la aceptación visual de la
   instancia del usuario y del recorrido de mejora de la propia oficina.

## Referencias de implementación y prueba

- [Gestión de plugins](GESTION_PLUGINS.md).
- [MCP de plugins seleccionados](MCP_PLUGINS_LOCALES.md).
- [Autenticación oficial](AUTENTICACION_OFICIAL.md).
- [Aplicaciones alojadas](APLICACIONES_ALOJADAS.md).
- [Integraciones oficiales](INTEGRACIONES_OFICIALES.md).
- [Conversación real con GitHub](VALIDACION_CONVERSACION_GITHUB.md).
- [Desactivación local de conexiones](DESACTIVAR_CONEXIONES.md).
- [Revisión humana de resultados inciertos](REVISION_RESULTADOS.md).
- [Base de registro MCP oficial](REGISTRO_MCP_OFICIAL.md).

Los logs, recibos y huellas detalladas permanecen en el estado privado ignorado;
no se publican credenciales, transcripciones ni configuraciones personales.

Última comprobación: 1.020 pruebas del servidor aprobadas, dos opcionales omitidas,
tipos y compilación completos correctos. Actualización aplicada con la oficina
inactiva; las dos conversaciones y sus 38 mensajes mantienen hash idéntico y no se
reanudó trabajo automáticamente. MCP real: una llamada de eco, retirada confirmada
y ausencia de procesos restantes; no se inició un modelo en esa prueba.

Revisión de resultados: 88 pruebas de interfaz aprobadas, lectura y revisión por
API local comprobadas con proveedores simulados y persistencia por versión sin
alterar los recibos. La API de la instancia actualizada responde correctamente;
no se ha registrado ninguna revisión automática de un resultado real. La aceptación
visual continúa pendiente.

Registro oficial: implementado y comprobado con el CLI real en dos
perfiles temporales, incluido primer uso sin archivo de configuración. Reutiliza
entradas compatibles y rechaza cambios concurrentes o colisiones. 44 pruebas
específicas del registro y ejecutor aprobadas en esa fase. El registro está unido
al inicio de sesión, cancelación y llamadas desde las herramientas de los empleados.
La comprobación posterior suma 1.040 pruebas del servidor aprobadas y dos omitidas,
y 88 de interfaz. Se ejecutó una búsqueda real `search_openai_docs` mediante el
CLI `0.163.0-alpha.11.2`, sin inferencia ni credenciales copiadas, y se verificó la
retirada del registro temporal. Esto acredita el transporte público; el inicio
de sesión real y la aceptación visual siguen pendientes.

La actualización local de este recorrido está aplicada en el puerto 4173: oficina
inactiva antes y después, dos conversaciones y 38 mensajes con hash idéntico. Tras
la batería completa se añadió el recibo previo al envío HTTP para cubrir un cierre
inesperado; las 19 pruebas relacionadas pasan. Tipos, lint y compilación correctos,
con los avisos previos del hook del editor y tamaño del paquete web.

Aplicaciones alojadas: actualización aplicada después, con hash del historial
idéntico y oficina inactiva. 1.056 pruebas del servidor y 89 de interfaz aprobaron
la entrega; después, 45 pruebas específicas verificaron la conexión desde las
aplicaciones declaradas por plugins. Tipos, lint y compilación correctos. Prueba
real del paquete GitHub instalado y su aplicación completada sin modificarla,
repetir autenticación o iniciar un modelo. La API actualizada distingue ocho
aplicaciones del runtime instalado del directorio general con 403.

La elección de otra cuenta o servicio para probar un inicio de sesión nuevo está
consultada al usuario. GitHub ya conectado no se desconecta para fabricar esa
prueba. La comprobación visual sigue aplazada por indicación del usuario.

El usuario ha elegido **Vercel** para el inicio de sesión nuevo. Se ha preparado
desde Conversaciones el registro del MCP oficial y una autorización OAuth real
administrada por Codex. El primer intento se interrumpió al cerrar el turno del
modelo con la herramienta pendiente: no se confirmó la cuenta ni se consultaron
equipos. Se conserva el registro, el recibo y la pregunta del Jefe para aprobar
o denegar otro intento en «Conexión Vercel». Se ha añadido espera de herramientas
antes del cierre y clasificación determinista de cancelaciones, con 77 pruebas
específicas aprobadas. El nuevo OAuth real y la consulta posterior siguen pendientes.

La corrección de cierre con herramientas pendientes está aplicada con la oficina
inactiva. 1.062 pruebas del servidor aprobaron la versión, con dos opcionales
omitidas; tipos, lint y compilación completos correctos. La comprobación del
reinicio detectó otro defecto: conservaba el texto de la pregunta pero cambiaba
su motivo de pausa, haciendo que la respuesta pudiera rechazarse como caducada.
No se perdió contenido ni se reanudó trabajo. Se ha corregido la recuperación de
preguntas pendientes, incluidas las ya afectadas por ese cambio, y sus 22 pruebas
de integración pasan. La aplicación y comprobación final de esa reparación se
registran por separado; no se da por válido el primer control de hash fallido.

Reparación aplicada y comprobada: las preguntas pendientes conservan
`office_human_required`, su identificador y sus controles de respuesta. La auditoría
contra los recibos anteriores acredita que únicamente se reparó el motivo de
pausa de preguntas históricas; no cambió contenido de mensajes. Tras esa reparación,
otro reinicio conserva hash idéntico de las cuatro conversaciones y 54 mensajes,
mantiene la oficina inactiva y no inicia otro OAuth. El intento nuevo de Vercel
sigue esperando la decisión explícita de su titular dentro de la conversación.

El intento separado de instalación del paquete oficial remoto Vercel 0.54.1
quedó incierto. Una inspección oficial posterior confirma que actualmente no
figura instalado ni habilitado; se conserva el recibo original, visible para
revisión humana en la oficina, sin darlo por resuelto ni repetir la instalación.
No se inició un modelo, no se ejecutaron skills ni se realizó otro OAuth en esa
comprobación. La causa original no quedó acreditada.

Se ha eliminado además el plazo genérico de transporte de 30 segundos para
instalaciones, retiradas y llamadas MCP: conservan la cancelación del cliente y
los plazos propios del proveedor. Los fallos futuros guardan código seguro,
fecha y fase (solicitud o verificación), sin almacenar el contenido privado del
error. Las 29 pruebas específicas pasan, incluidas desconexión, ausencia de
reenvíos y conservación de diagnósticos. Esto no prueba que el plazo fuera la
causa de aquel intento incierto.

Actualización aplicada con la oficina inactiva: tipos, lint y compilación correctos;
cuatro conversaciones y 54 mensajes conservan hash idéntico tras reiniciar. La
suite del servidor obtuvo 1.068 pruebas aprobadas, dos omitidas y un fallo por
superar los diez segundos de una prueba de integración de escritores. Esa misma
prueba, repetida sola sin cambiar código ni ampliar su plazo, aprobó en 8,5
segundos. Se conserva la diferencia; no se presenta la ejecución conjunta como
completamente aprobada. El nuevo OAuth y la revisión del recibo incierto siguen
pendientes de decisiones humanas.

El panel de resultados inciertos identifica ahora versión y marketplace del
plugin y muestra diagnósticos reconocidos y fase cuando constan en el recibo.
21 pruebas de registro, rutas e interfaz aprobadas; tipos, lint y compilación
correctos. Aplicado estando inactiva la oficina, con hash idéntico de los 54
mensajes. La API real devuelve el recibo pendiente de Vercel 0.54.1 con su origen
`openai-curated-remote`, sin inventar un diagnóstico para ese intento antiguo.
No se registró ninguna decisión humana ni se repitió la operación. La apariencia
y la interacción visual siguen pendientes de aceptación.

Vercel: el usuario aprobó el reintento y completó el acceso oficial. Codex confirmó
OAuth, y el Tester contrastó su estado. La conexión quedó pausada porque el equipo
no tenía una operación separada para actualizar su catálogo guardado. Se ha añadido
`connection_check`, disponible para lectores, sin registro, OAuth ni llamadas al
proveedor; comparte exclusión y cancelación. Prueba real de la nueva operación:
238 herramientas y un esquema `list_teams` recuperados, sin inferencia ni consulta
de equipos. Pasaron 32 pruebas pertinentes y, tras reforzar la exclusión, las 21
del gestor y conexiones administradas. Tipos, lint y compilación correctos.

Actualización aplicada estando inactiva la oficina: cuatro conversaciones y 65
mensajes conservan hash idéntico. El recibo OAuth sigue `authenticated` después
del reinicio y la pregunta del Jefe sigue pendiente; no se respondió en nombre
del usuario ni se reanudó el encargo. Falta la continuación explícita desde la
pregunta y la consulta única del Tester con aprobación de la operación.

También se corrigió el descubrimiento general: anunciaba «falta un adaptador»
para cualquier MCP distinto de `codex_apps`, incluido Vercel administrado. Ahora
reconoce únicamente la entrada oficial correspondiente y el soporte efectivo del
ejecutor; explica la actualización del catálogo y la llamada aprobada, sin
habilitar servidores desconocidos o desactivados ni declarar una operación
verificada. Ocho pruebas pertinentes aprobadas, más repetición de la prueba de
ausencia del adaptador; tipos, lint y compilación correctos. Aplicado inactivo
con hash idéntico de 65 mensajes. La API real confirmó HTTP 200, «Conexión:
Vercel», 238 herramientas y la ruta `connection_check` → `connection_call`.
La pregunta histórica mantiene su texto original; el descubrimiento actual
sustituye su diagnóstico de adaptador ausente. No se reanudó trabajo.

Continuación real completada por la persona desde Conversaciones: el Tester
actualizó el catálogo con `connection_check` y presentó la aprobación específica
de `list_teams {}`. Tras esa aprobación, el adaptador pasó a `available`; el Tester
informó respuesta sin error con cero equipos, entregó revisión sin hallazgos y
el Jefe cerró el objetivo de conexión. Ambos registros reales están completados,
con cuota incluida y contadores conocidos. La conversación guarda 26 mensajes y
se recuperó sin cambios. Evidencia privada: `.local-office/vercel-success/evidence.json`.
No se repitió la consulta durante la auditoría ni se inició otro OAuth. Este
resultado cierra la validación operativa de Vercel, no el objetivo global: siguen
pendientes revocación, aceptación visual, instalación remota incierta y recibos
individuales de las operaciones administradas. La cantidad de llamadas y la
respuesta vacía constan en el informe del empleado; el adaptador actual no ofrece
un historial global suficiente para acreditarlas independientemente.

Recibos individuales implementados para llamadas nuevas: guardado previo al envío,
identificador devuelto al empleado, aprobación real vinculada, encargo y huellas
de argumentos, esquema y respuesta sin conservar su contenido. Consulta mediante
`connection_operations` y **Recibos de operaciones** en cada conexión. Se conserva
el bloqueo ante incertidumbre, incluida una interrupción entre la escritura del
recibo y la del estado. La revisión humana deja el original intacto, no declara
un resultado y no ejecuta nada. Ver [contrato y pruebas](RECIBOS_CONEXIONES.md).

Suite completa de servidor: 1.076 aprobadas y dos opcionales omitidas, ejecutada
con 30 segundos por prueba; interfaz: 91 aprobadas. Después se reforzó la exclusión
de revisiones declaradas por el propio recibo: 25 pruebas pertinentes aprobadas,
incluida esa comprobación adicional. Tipos, lint y compilación correctos. Aplicado
inactivo con hash idéntico de los cuatro chats y 72 mensajes. La API real devuelve
HTTP 200, fecha de inicio del registro y cero recibos para la consulta antigua;
OAuth se conserva. No se realizó una llamada nueva ni se acredita aceptación
visual por estas pruebas. La operación anterior de Vercel mantiene su limitación
histórica de trazabilidad.

Decisión humana posterior: **Conservar Vercel conectado**. La prueba real de cierre
local quedó preparada, con OAuth vigente comprobado, pero no se ejecutará ni se
volverá a solicitar sin una nueva indicación. No se cierra ni se revoca la conexión
para fabricar evidencia. La inspección de las 238 herramientas no identificó un
revocador de esta autorización; las operaciones de tokens Global Config y claves
KMS no son equivalentes. La revocación remota sigue sin acreditarse. La decisión
no pausa el resto del objetivo ni convierte esa validación omitida en aprobada.

**Recibos nuevos comprobados realmente.** En «Validación de recibos», la persona
aprobó una consulta adicional y el Tester ejecutó `list_teams {}` mediante el
adaptador oficial. El backend registra exactamente un recibo nuevo completado,
vinculado a esa aprobación, al encargo y a la conversación. La auditoría compara
independientemente esos identificadores, sus fechas y la huella de argumentos.
El Tester releyó el recibo y el Jefe aceptó la entrega. Los tres turnos reales
Jefe → Tester → Jefe terminaron con cuota incluida y contadores conocidos.

Un reinicio con la oficina inactiva preservó el recibo y la aprobación con hash
idéntico, sin nuevas llamadas ni trabajo reanudado. Los cinco chats y 80 mensajes
conservan hash idéntico; los cuatro chats anteriores y 72 mensajes también están
intactos. La nueva conversación guarda ocho mensajes. OAuth de Vercel permanece
registrado y no se cerró su sesión. Evidencia privada en
`.local-office/receipt-office/`; la aceptación visual y la revocación siguen
pendientes, al igual que el recibo incierto del plugin remoto y la prueba de una
aplicación alojada nueva. Este avance no cierra el objetivo global.

**Instalación remota y lectura de skills completadas después.** La revisión
técnica, autorizada expresamente por el usuario, conservó los recibos anteriores.
El HTTP 404 se debía a enviar el nombre visible en una operación que requiere el
identificador remoto del catálogo. Se corrigieron instalación y retirada, con
revalidación de esa identidad y conservación de los IDs del historial. El paquete
oficial Vercel 0.54.1 quedó instalado y verificado. La primera retirada por su
identidad local no completó la retirada remota; también se conserva y revisó ese
recibo. Tras corregirla, se leyó realmente `cdn-caching` mediante
`plugin/skill/read`: texto principal completo de 21.014 caracteres, guardado con
huella, sin ejecutar sus instrucciones ni iniciar un modelo. La retirada remota
final está verificada y no queda un paquete de prueba pendiente de limpieza.
El inventario de otros plugins se mantuvo idéntico durante esa retirada final.

También se corrigió el guardado simultáneo de recibos de autenticación. Una
prueba reproduce el conflicto de Windows y comprueba persistencia y recuperación
tras serializar los reemplazos. La batería final del servidor aprobó **1.094
pruebas**, sin fallos y con dos opcionales omitidas. Tipos, lint y empaquetado
correctos, con los avisos previos del hook del editor y tamaño del paquete web.
La actualización se aplicó con la oficina inactiva: cinco chats y 80 mensajes
con hash idéntico, recibo anterior y aprobación intactos, sin nuevas llamadas
administradas ni trabajo reanudado. La comprobación oficial de OAuth sigue
indicando `oAuth` y la conexión MCP Vercel permanece habilitada. No quedan
revisiones de operaciones pendientes por estos ensayos.

Evidencia privada compuesta en `.local-office/remote-plugin-lifecycle-final.json`,
con referencias a los recibos originales y a `.local-office/remote-plugin-cleanup/`.
Se completó en dos fases después de las correcciones; no se reescribieron como
éxitos los ensayos anteriores. Siguen pendientes la aceptación visual aplazada,
el inicio de sesión de una aplicación alojada nueva y la revocación remota en el
proveedor. Se conserva la elección del usuario de mantener Vercel conectado y
no se vuelve a solicitar su desconexión para fabricar una prueba.

El ensayo optativo de Windows se ejecutó de nuevo con el auxiliar real y una
ventana de prueba propia. Windows volvió a negar el foco. Pasaron inspección,
exclusión, aprobación y parada; la evidencia registra expresamente
`realWritingVerified: false`. El test verde de esos controles no acredita una
escritura que no ocurrió. No se forzó el foco ni se apuntó a una aplicación del
usuario. Evidencia privada: `.local-office/windows-owned-final-evidence.json`.

**Conexión alojada preparada por el Jefe real.** La consulta oficial distingue el
MCP directo ya conectado de la aplicación Vercel de ChatGPT: esta última no
figuraba instalada ni callable. En el proyecto «Vercel en aplicaciones», un Jefe
real ejecutó `plugins_list`, solicitó la instalación del paquete oficial y obtuvo
un recibo verificado vinculado a su encargo y conversación. Después preparó
`app_connect` desde la aplicación anunciada por ese paquete. Las dos operaciones
concretas se revisaron bajo la autorización expresa del usuario para completar el
objetivo, sin pedirle permisos repetidos. El modelo no aprobó sus propias llamadas.

La tarjeta oficial está en espera del inicio de sesión personal en ChatGPT y el
proveedor. Ese estado no acredita conexión ni uso; sólo el comprobador oficial
puede aceptar después `enabled` y `callable`. No se ha ejecutado una operación del
proveedor por este canal ni se ha cerrado la sesión del MCP directo. El paquete
se conserva instalado para este recorrido real, a diferencia del paquete temporal
retirado durante el ensayo anterior. Hay seis conversaciones y 84 mensajes; los
cinco chats anteriores y sus 80 mensajes mantienen hash idéntico. No se reinicia
la oficina mientras el encargo está esperando este paso.

Evidencia privada: `.local-office/hosted-vercel-office/`, con estado, aprobaciones
concretas y auditoría de preparación. El inicio de sesión real de esta aplicación,
su operación posterior y el cierre final del Jefe siguen pendientes.

**Caducidad real y pausa determinista.** La espera personal anterior caducó sin
confirmarse. El paquete permanece instalado y el MCP directo sigue habilitado.
El Jefe pidió dos revisiones documentales innecesarias antes de reconocer el
bloqueo. Se conservan los cinco recibos reales de ejecución, con cuota incluida
y contadores conocidos; los fallos del Tester indican objetivo pendiente, no
ausencia de herramientas ni fallo de infraestructura. No se repitió la conexión.

Ese recorrido detectó y permitió corregir un fallo del coordinador: un recibo
alojado caducado del turno actual no detenía las propuestas de revisión o cierre.
Ahora el servidor pausa antes de despachar más trabajo y presenta el paso
personal concreto; no depende sólo de las instrucciones del Jefe. Tres casos
nuevos comprobaron caducidad actual, autenticación válida e incidencia antigua,
y pasaron 112 pruebas relacionadas. La corrección está probada localmente; no
se repitió un inicio de sesión real para fabricar evidencia. Tipos, lint y
empaquetado correctos, con los avisos previos. Actualización aplicada estando
inactiva: seis conversaciones y 92 mensajes con hash idéntico antes y después,
sin reanudar trabajo. Los cinco chats originales y 80 mensajes siguen intactos.
La consulta oficial posterior sigue sin anunciar la aplicación alojada como
habilitada o callable; no acredita que la persona haya completado ese paso.
El objetivo y su pregunta se conservan en pausa, sin otra autorización solicitada.
