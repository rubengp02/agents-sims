# Objetivo cerrado: ecosistema autónomo de la oficina

Las nuevas prioridades se registran en [Objetivos actuales](OBJETIVOS_ACTUALES.md).
Este documento conserva el cierre y la evidencia de la entrega anterior.

## Aceptación de cierre del 25 de octubre de 2026

Tras conocer la diferencia entre cierre local y revocación en el proveedor, el
usuario indicó: «yo creo que el objetivo sí está completo». Se cierra la entrega
operativa con esa aceptación. La desconexión validada comprende el cierre OAuth
oficial (`notLoggedIn` desde un cliente nuevo) y la desactivación de la conexión
local. La revocación del permiso en los servidores de Vercel queda documentada
como limitación aceptada de este cierre, no como una prueba superada ni como una
capacidad disponible. No se exigirán nuevas intervenciones para esta entrega.

Se mantienen las evidencias y resultados originales, incluidos los fallos
corregidos. La oficina está actualizada e inactiva, con diez conversaciones y
135 mensajes preservados en el último reinicio. Vercel está desconectado.
Las notas siguientes conservan la evolución y los criterios anteriores al cierre.

Autorizado por el usuario el 23 de octubre de 2026. Continuar la implementación y
validación sin solicitar autorización para cada entrega local. No cerrar el
objetivo por completar un bloque, compilar o pasar pruebas simuladas.

El usuario ha reiterado su autorización completa para realizar las acciones
necesarias de este objetivo, sin volver a pedir confirmaciones rutinarias. Las
revisiones técnicas pueden completarse con esa autorización y evidencia actual,
dejando constancia de quién las realiza; no equivalen a una inspección personal
del usuario ni permiten convertir un recibo incierto en un éxito histórico.
La elección inicial era conservar Vercel conectado. El 25 de octubre el usuario
pidió desconectarlo para completar la validación: se ejecutó el cierre OAuth
oficial y un cliente nuevo confirmó `notLoggedIn`; la conexión local también
quedó deshabilitada. No se declara revocación del permiso en el proveedor.
Un inicio de
sesión que exija intervención del titular se explica como tal, sin pedir de nuevo
permiso para preparar el recorrido.

Consulta el [estado actual verificable](ESTADO_ECOSISTEMA.md) para distinguir lo
implementado, las comprobaciones reales y los siguientes trabajos. Las notas
históricas siguientes describen avances sucesivos y no sustituyen ese estado.

## Criterios de cierre

- [x] Herramientas de descubrimiento y conexiones MCP HTTP invocables por empleados.
- [x] Aprobaciones por operación, cancelación y conservación de conexiones.
- [x] Catálogo oficial de plugins con propuestas de procedencia y efectos.
- [x] Instalación administrada, verificación posterior y retirada/reversión local
      comprobadas con paquetes temporales reales; detalle en el estado actual.
- [x] Inicio de sesión mediante mecanismos oficiales, sin manipular credenciales:
      OAuth real de Vercel confirmado, catálogo y consulta posterior completados.
- [x] Interacción dentro de Conversaciones: decisión, autenticación, consulta
      aprobada del Tester y aceptación final del Jefe en el recorrido real Vercel.
      Esto no acredita todavía aceptación visual ni revocación remota.
- [x] Acceso compatible a las capacidades para los distintos empleados,
      manteniendo la revisión independiente y los permisos por función.
- [x] Recuperación tras reiniciar sin repetir operaciones o trabajos: recibos
      previos al envío, bloqueo de incertidumbre y pruebas locales de recuperación.
- [x] Recorrido real con un empleado y GitHub en solo lectura, con cuota incluida.
- [x] Pruebas locales, pruebas reales identificadas, actualización inactiva e
      historial conservado; limitaciones residuales declaradas y sin falsear cierre.
- Limitación aceptada al cierre: revocación de permisos en un proveedor real y comprobación posterior de
  acceso denegado en ese proveedor. El cierre local real de Vercel está probado,
  pero no acredita por sí solo la retirada de la autorización remota.

El usuario confirmó el recorrido de la interfaz («Está todo bien») y señaló
mejoras en los títulos de actividad y la proporción del equipo. Esas mejoras se
aplicaron y probaron; los seguimientos se comprobaron también con Codex real:
tres peticiones, una ejecución del Jefe por petición, sin herramientas innecesarias
ni otros empleados, e historial anterior intacto. No se exige repetir la misma
aceptación visual como bloqueo. Queda la revocación remota real, que no se
sustituye por un cierre local ni por pruebas simuladas.
La escritura real de Windows ya se verificó el 25 de octubre en una aplicación
propia con el auxiliar nativo. El canal alojado de Vercel se declara no disponible
en el ejecutor actual; su MCP operativo permite trabajar y no se bloquea por
la ausencia de esa segunda vía. Consulta los [pasos del usuario](VALIDACION_USUARIO.md).
La instalación y retirada remotas de Vercel ya están
comprobadas realmente, incluida la lectura de una skill. Los recibos nuevos ya
tienen comprobación real con aprobación humana y recuperación idéntica tras
reiniciar. GitHub y el recorrido OAuth → catálogo → consulta de Vercel
tienen comprobaciones reales; no sustituyen esos requisitos restantes. Las notas
históricas de abajo conservan sus resultados originales, incluidos los pendientes
que ya se resolvieron después: el estado actual enlazado arriba es la referencia.

## Siguiente trabajo independiente del bloqueo de GitHub

Gestión implementada y probada localmente: [gestión de plugins](GESTION_PLUGINS.md).
La consulta real del catálogo ya reconoce GitHub instalado y habilitado. Se han
añadido búsqueda y paginación, selección por identidad y origen, propuestas,
revalidación previa, verificación posterior y recibos sin reenvío automático.
No se han instalado ni retirado paquetes reales. La autenticación y el uso real
por un empleado siguen pendientes; son los siguientes trabajos del objetivo.

Implementar la gestión de plugins con las operaciones oficiales `plugin/list`,
`plugin/read` y `plugin/install` del protocolo del CLI instalado. Resolver los
identificadores contra el catálogo del servidor; no aceptar rutas ni comandos
del modelo. Mostrar una propuesta concreta y verificar de nuevo su procedencia
antes de instalar. No cambiar las desactivaciones generales hasta verificar los
controles de efectos de cada integración.

Después, conectar la autenticación oficial al ciclo de vida del encargo y a la
interfaz. Una URL de autorización no acredita una conexión: comprobar notificación
de finalización, cancelar al detener y verificar una operación posterior.

## Bloqueo de GitHub conocido

El gestor de plugins del escritorio reconoce GitHub instalado y habilitado.
El catálogo `app/list` del ejecutor independiente recibe HTTP 403 con una
comprobación de Cloudflare. No eludir esa protección ni copiar sesiones del
navegador. No concluir que las credenciales de GitHub son incorrectas.
Este bloqueo no impide implementar y probar localmente el resto del ciclo.

## Evidencia y límites

Conservar pruebas y resultados en el estado privado ignorado. No publicar logs,
tokens, transcripciones ni rutas personales. La evaluación real solo utiliza
cuota incluida. La consulta de GitHub autorizada es de solo lectura: publicar o
modificar servicios externos conserva la aprobación específica de cada operación.

Última evidencia: 959 pruebas del servidor aprobadas y dos opcionales omitidas,
compilación completa correcta. Catálogo oficial consultado realmente con plugins
habilitados únicamente en el cliente de gestión: 7.733 entradas, siete conflictos
y GitHub instalado/habilitado en `openai-curated-remote`. Los conflictos no se
modifican. La instancia local está actualizada, inactiva y conserva sus 36 mensajes
con el mismo hash del historial. No se han instalado ni retirado paquetes reales.
Estos resultados no acreditan todavía autenticación ni un recorrido real de
GitHub desde un empleado.

Continuación: implementar el ciclo oficial de autenticación y su interfaz. El
protocolo instalado ofrece `mcpServer/oauth/login` y notificación de finalización
con `loginId`, nombre y resultado; los detalles de plugins también contienen
resúmenes de aplicaciones y URL oficial de instalación. No confundir esas URL o
notificaciones con acceso operativo: se requiere comprobación posterior. Mantener
el servidor del intento vivo, correlacionar el resultado, cancelar al detener y
no guardar credenciales. Examinar después la exposición del puente oficial de
aplicaciones a los empleados sin relajar las aprobaciones por operación. El
catálogo de aplicaciones `app/list` sigue bloqueado; no eludir su protección.

Avance posterior: ciclo OAuth de servidores MCP registrados implementado en
[autenticación oficial](AUTENTICACION_OFICIAL.md), con tarjeta en Conversaciones,
cancelación, correlación por `loginId`, verificación posterior y recibos sin URL.
No se da por cerrada la autenticación global: falta la de aplicaciones alojadas
y conexiones HTTP propias. Consulta real del estado: el puente `codex_apps`
declara `bearerToken`, no OAuth pendiente. No pedir ni manipular ese token.

Validación de este avance: 973 pruebas del servidor aprobadas, dos opcionales
omitidas y 83 pruebas de interfaz aprobadas; compilación completa correcta. Se
ha aplicado la actualización a la oficina inactiva y se ha verificado salud,
ausencia de trabajo autoanudado y los 36 mensajes con hash sin cambios. No se ha
iniciado autenticación de cuentas reales. Los recibos OAuth son públicos y no
contienen URL temporal; el resultado de la herramienta tampoco devuelve esa URL
al modelo. La interfaz la muestra solo mientras el intento está vigente.

Siguiente investigación: el esquema local expone `mcpServer/tool/call` además de
`mcpServerStatus/list`. Evaluar ese acceso oficial al puente existente y sus
aprobaciones por operación, sin eludir el 403 de `app/list`. Verificar primero
metadatos y compatibilidad; después la consulta GitHub de solo lectura autorizada
con un empleado real. No asumir que instalar un plugin equivale a conectarlo.

Avance operativo: [integraciones oficiales](INTEGRACIONES_OFICIALES.md) compartidas
mediante catálogo con búsqueda, llamada aprobada y recibos recuperables. El puente
oficial completó la consulta de identidad GitHub. Un Tester real descubrió y usó
la herramienta desde el MCP de la oficina; terminó `completed`, con una operación,
una aprobación y consumo verificable. Se conserva un intento anterior pausado por
cota de validación. No se cambió ningún repositorio ni se leyeron credenciales.

Pendiente: recorrido visual completo desde la interfaz; autenticación
de aplicaciones alojadas y MCP HTTP propios; revocación de autorizaciones de
servicios; uso operativo de plugins locales compatibles; pruebas reales de
instalación y retirada cuando exista una propuesta autorizada. No cerrar el
objetivo por tener un catálogo o una única operación GitHub comprobada.

Avance de persistencia: [conversación real con GitHub](VALIDACION_CONVERSACION_GITHUB.md)
comprobada mediante API local y modelo real. Una petición y una respuesta quedan
guardadas y se recuperan idénticas al reabrir. El chat original permanece intacto
y se restauró su selección. La prueba visual sigue pendiente porque el navegador
está desactivado en Work. El usuario ha indicado dejar esa comprobación pendiente;
se continúa con trabajos independientes sin intentar eludir ese bloqueo.

La [desactivación de conexiones HTTP](DESACTIVAR_CONEXIONES.md) ya tiene control
local, herramienta de empleado aprobada, cancelación y persistencia. No sustituye
la revocación de permisos en el proveedor: esta última permanece pendiente.

Actualización posterior: las operaciones HTTP con resultado incierto bloquean
nuevas solicitudes hasta una revisión humana explícita, conservada al reiniciar
y reconectar. La revisión nunca reenvía la operación. Pasan 11 pruebas del gestor,
8 de rutas, 85 de interfaz y la compilación completa. La instancia actualizada
conserva las dos conversaciones y sus 38 mensajes con hash idéntico, sin encargos
reanudados automáticamente.

Avance posterior: [cierre de sesión OAuth local](AUTENTICACION_OFICIAL.md) mediante
el comando oficial específico de MCP, aprobación concreta, revalidación del
catálogo y comprobación desde un cliente nuevo. Recibos persistentes y consulta
posterior permiten resolver un resultado incierto comprobando el estado, sin
repetir el cierre. No afecta a la cuenta ChatGPT ni se anuncia como revocación
remota. Prueba real limitada a la ayuda del CLI; no se cerró ninguna sesión real.
Suite completa: 992 pruebas aprobadas y dos omitidas; tras endurecer el catálogo,
52 pruebas específicas aprobadas, tipos y compilación completos correctos.
Instancia actualizada inactiva; las dos conversaciones y los 38 mensajes conservan
hash idéntico. La revocación en proveedores y la aceptación visual siguen pendientes.

Avance de plugins: los empleados pueden consultar capacidades declaradas, cargar
skills locales completas y leer sus referencias por bloques mediante IDs oficiales.
Se respetan los permisos de lectura, se rechazan archivos fuera del paquete y
datos sensibles y se comprueba la procedencia de nuevo antes de entregar el texto.
Lectura real de la skill instalada `computer-use:computer-use`, versión
`26.1013.40934`: 1.497 caracteres completos, sin ejecutar herramientas ni modelo.
Codex declara esa skill desde su carpeta oficial temporal de plugins incluidos;
el resultado diferencia ese origen de la caché instalada. Los MCP de plugins
locales siguen sin adaptador operativo comprobado.

Instalación y retirada reales comprobadas en un `CODEX_HOME` aislado, con un plugin
local de prueba que sólo contiene instrucciones. Se verificaron ambos estados,
dos aprobaciones limitadas al piloto y recuperación del recibo. No se usaron
credenciales ni modelos ni se cambió la configuración habitual. Sigue pendiente
el recorrido visual y la validación de paquetes remotos conectados; no equivale
a completar la autenticación o el uso de sus MCP.

Comprobaciones de este bloque: 31 pruebas locales relacionadas aprobadas y
compilación completa correcta. Evidencia en el estado privado: lectura real de
skill y ciclo de instalación aislado, con distinción explícita entre aprobaciones
automatizadas del piloto y operación humana en la interfaz.
Actualización aplicada con la oficina inactiva; las dos conversaciones y sus 38
mensajes conservan hash idéntico después del reinicio, sin tareas reanudadas.

Validación y despliegue del adaptador: 980 pruebas del servidor aprobadas, dos
opcionales omitidas; compilación completa correcta. Instancia actualizada tras
verificar que estaba inactiva, sin reanudar encargos. Los 36 mensajes originales
se conservan con hash idéntico. El catálogo de aplicaciones bloqueado tiene ahora
su propio estado, separado de la verificación de operaciones del puente.
