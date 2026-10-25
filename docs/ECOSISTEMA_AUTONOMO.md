# Capacidades administradas desde Conversaciones

El objetivo es que el Jefe resuelva las necesidades de herramientas desde la
oficina. No se considera completado por tener acceso a un terminal.

## Entrega implementada

- `capabilities_discover`: consultar catálogos oficiales de aplicaciones, skills y
  MCP instalados. Es consulta de metadatos; no ejecuta modelos ni acredita que una
  operación funcione.
- `connections_list`: consultar las conexiones MCP administradas, su catálogo y
  última comprobación.
- `connection_connect`: proponer nombre y URL de un servidor MCP HTTP público.
  La oficina presenta la conexión para aprobarla o denegarla dentro del chat;
  únicamente después contacta con el servidor. No instala ejecutables.
- `connection_call`: ejecutar una herramienta concreta con sus argumentos,
  mostrando la operación y destino para aprobación individual. La autorización
  de conectar no autoriza operaciones posteriores. La cancelación invalida las
  aprobaciones y cancela el transporte. No hay reenvío automático si el resultado
  queda incierto.

El registro se conserva fuera del proyecto, sin claves ni credenciales. Al
reiniciar, las conexiones vuelven a «Sin comprobar» y no se ejecutan operaciones.
Consultar el catálogo no marca una conexión como «Lista»: hace falta completar
una operación sin error. «Lista» tampoco garantiza todas las herramientas del
servidor ni autoriza futuras acciones.

La conexión usa el SDK oficial MCP con HTTPS, sin redirecciones ni credenciales
en URL. La resolución DNS del propio socket rechaza destinos privados, locales
y enlaces a metadatos. No se aceptan comandos de instalación ni configuraciones
arbitrarias enviadas por el modelo. Los catálogos y resultados se tratan como datos
externos, sin autoridad sobre permisos u objetivo.

## Comprobación

Pruebas locales de aprobaciones, retirada, cancelación, argumentos inmutables,
persistencia, autenticación pendiente y resultado incierto. El recorrido MCP HTTP
usa el SDK y un servidor local de prueba reales, con transporte inyectado. La
conexión HTTPS a un servicio externo y la decisión de un modelo real todavía no
se han comprobado. No se han instalado plugins ni conectado cuentas del usuario.

## Trabajo pendiente para completar el ecosistema

Avance: [el puente oficial ya tiene una operación GitHub comprobada](INTEGRACIONES_OFICIALES.md),
incluida una consulta de solo lectura con un Tester real. El fallo 403 de
`app/list` no afecta a esa llamada por su canal oficial. La autenticación existente
la administra Codex; no se copiaron credenciales. El objetivo global sigue abierto.

Actualización: la [gestión oficial de plugins](GESTION_PLUGINS.md) ya está
implementada y probada localmente, incluyendo propuestas y retirada. La consulta
real del catálogo confirma GitHub instalado y habilitado desde el ejecutor. Falta
validar mutaciones reales autorizadas, autenticación y uso por un empleado.

Comprobación real de GitHub: el gestor oficial de plugins de Codex informa de
GitHub instalado y habilitado. El ejecutor App Server detecta el puente de
aplicaciones, pero `app/list` recibe HTTP 403 con una comprobación de acceso de
Cloudflare. Son superficies diferentes: la instalación en la aplicación no
acredita acceso desde el ejecutor de la oficina. El catálogo muestra este bloqueo
sin concluir que falta instalar GitHub o que sus credenciales son incorrectas.
No se ha completado una operación de GitHub desde un empleado real ni una nueva
autenticación. No se han modificado repositorios ni eludido la protección.

1. Autenticación mediante los mecanismos oficiales del ejecutor, con devolución
   del control al encargo tras iniciar sesión. Por ahora, un servidor que devuelve
   401/403 queda en «Requiere conexión» con explicación; no se piden tokens en chat.
2. Instalación y actualización de plugins/MCP locales mediante propuestas de
   procedencia, cambios, efectos y reversión verificables. No ejecutar paquetes
   arbitrarios para eludir una conexión incompatible.
3. Retirada y revocación de conexiones desde la interfaz, gestión de versiones y
   validación de compatibilidad de capacidades exclusivas del escritorio.
4. Evaluación real del recorrido completo, autorizada por bloques, usando solo
   cuota incluida y conservando evidencia de las operaciones realizadas.

El gestor permite incorporar y utilizar MCP HTTP compatibles sin cambiar código
para cada servicio. No representa aún un instalador universal ni equivale a todas
las capacidades de la aplicación de Codex.
