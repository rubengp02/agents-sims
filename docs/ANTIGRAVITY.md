# Antigravity en la oficina

El adaptador utiliza el CLI oficial agy, su sesión Google y cuota incluida.
Codex sigue siendo el proveedor predeterminado. Para elegir Antigravity, habilítalo
en Equipo y selecciónalo en «Proveedor del equipo». No existe cambio silencioso de
motor si una comprobación falla.

## Cuota y modelos

Antes de cada intento se consultan versión, catálogo, /config y /usage. Los
comandos de metadatos fuerzan el procesamiento de los comandos internos y no
consumen inferencia para descubrir el estado de la cuenta.

Se exige proveedor Google oficial, useG1Credits=false, acceso fuera del espacio
desactivado y revisión de permisos. La configuración efectiva se comprueba también
en la carpeta privada exacta de lanzamiento. No se leen ni copian credenciales ni
se cambian las preferencias personales. Un cambio de configuración, falta de datos
o menos del 10% de margen en una ventana del grupo del modelo impide continuar.
Durante la ejecución se repite la comprobación cada 30 segundos.

El catálogo conserva identificadores nativos, incluidas sus variantes de esfuerzo;
se seleccionan con esfuerzo default. La asignación automática provisional elige
Gemini low o high según el objetivo real, reservando high para la revisión del
Tester y sin confundir las instrucciones internas de seguridad con la complejidad
del trabajo. Su eficiencia no está benchmarkada.
El diagnóstico no atribuye un nombre comercial de suscripción a la cuenta.

El protocolo y guardián están acreditados para CLI **1.4.7 en Windows**. Otras
versiones quedan bloqueadas hasta verificar su compatibilidad. No se acredita
funcionamiento real en otros sistemas o con todos los modelos del catálogo.

## Herramientas, archivos y aprobaciones

Cada intento arranca desde una carpeta privada con un MCP de la oficina ligado
a una sesión, un bearer efímero y un hook oficial PreToolUse. El guardián deniega
herramientas nativas y otros servidores; permite las operaciones del MCP propio
y la lectura estricta de sus esquemas. El proyecto se consulta mediante el puente.
No se habilitan permisos ilimitados ni se modifica la configuración personal.

El servidor permite escribir y eliminar archivos únicamente al Programador con
escritura autorizada. Las actualizaciones y eliminaciones necesitan la huella del
archivo leído; crear exige que no exista. Se rechazan rutas externas, credenciales,
enlaces y sobrescrituras de versiones cambiadas. Las pruebas usan el registro
local autorizado; no se convierte un argumento del modelo en un comando arbitrario.
Los lectores conservan acceso a archivos, imágenes y comprobaciones.

Navegador, Windows, conexiones y plugins usan los mismos adaptadores y aprobaciones
de la oficina. Las integraciones oficiales compartidas se descubren mediante el
adaptador de metadatos de Codex, sin iniciar otro modelo para esa consulta.
Disponibilidad, autenticación y permisos siguen comprobándose por operación.
Una aprobación externa no puede reutilizarse ni autoriza futuros envíos.
Instalar un plugin no acredita que sus herramientas funcionen.

Las imágenes se entregan como contenido real de attachment_read, con índices
ligados al encargo; el cliente no escoge rutas del disco. Si un encargo con imágenes
no comunica su inspección, no se acredita completado. La generación nativa de
imágenes de Antigravity y los plugins exclusivos de su aplicación no están
acreditados por este adaptador. No se ofrece una API de pago como alternativa.

## Jefe, redirección y recibos

El Jefe reutiliza el identificador nativo de conversación dentro del mismo objetivo,
proyecto y modelo. Cada turno utiliza un proceso CLI que termina antes de liberar
las herramientas. Esto conserva contexto nativo; no mantiene un proceso abierto
indefinidamente. El Tester utiliza una sesión independiente.

«Aplicar ahora» en modo oficina interrumpe la actividad de forma controlada,
conserva cambios y recibos, invalida aprobaciones y revisiones anteriores y devuelve
el objetivo al Jefe. El CLI no ofrece turn/steer: la redirección individual en
pleno turno permanece deshabilitada; el mensaje puede quedar pendiente.

Los recibos requieren resultado final explícito, salida correcta del proceso,
identificador coherente y evidencia del guardián si hubo herramientas. Se conserva
el consumo final válido incluso si la entrega falla. Los contadores acumulados
del Jefe se convierten en consumo por turno; datos ausentes o decrecientes quedan
desconocidos. Cancelación y presupuestos detienen el proceso propio y liberan sus
recursos. Abrir o recuperar el historial nunca reanuda trabajo automáticamente.

## Evidencia y límites de la validación

El 26 de octubre de 2026 se comprobó realmente CLI 1.4.7, configuración sin créditos
adicionales y cuatro ventanas de cuota. Se realizaron pilotos con Gemini low:
lectura de una marca aleatoria mediante MCP; creación de un módulo CommonJS y prueba
local; reconocimiento de cuatro cuadrantes de colores en una imagen; y recuerdo
de una palabra aleatoria en un segundo turno del mismo Jefe, con el mismo
identificador nativo. Se conservaron los recibos, incluidos los intentos fallidos
que descubrieron y permitieron corregir el arranque del hook de Windows.

Las pruebas offline cubren metadatos, configuración por carpeta, reserva de cuota,
cancelación, timeout, fallo de recibos, guardián, aislamiento de empleados, imágenes,
continuidad y redirección coordinada. Las aprobaciones y conexiones se comprueban
con servicios simulados; estos pilotos no acreditan mutaciones reales en servicios
externos ni todas las capacidades del ecosistema.

También se completó un encargo desde Conversaciones en el navegador: el Programador
creó sum.cjs, el Tester realizó una revisión independiente y el Jefe entregó el
resumen final. La copia se integró y su prueba pasó. Se recuperó la misma conversación
tras varios reinicios explícitos. El recorrido de diagnóstico acumuló doce intentos;
los dos consumos sin recibo final se conservan desconocidos y el historial registra
al menos 865.597 tokens. No representa un benchmark de eficiencia.

Ese recorrido descubrió dos correcciones adicionales: revisar las copias privadas
por sus archivos completos aunque el repositorio contenedor las ignore, y conservar
los recibos de pruebas ejecutadas por MCP para la ficha final. La última corrección
y la recuperación de pruebas tras reiniciar se verifican con comandos locales y
ejecutores simulados; no se repite inferencia para acreditar esa lógica.

Los pilotos y sus recibos se guardan en .local-office/, fuera de Git.
La observación independiente con --providers antigravity es optativa y experimental:
no reproduce historiales antiguos y no sustituye la actividad estructurada de los
empleados administrados por el ejecutor.

Validación local: `npm test` aprobó 106 pruebas de interfaz, 1.225 de servidor y
8 contratos de empaquetado; dos pruebas de servidor quedaron omitidas. Después se
añadió y comprobó un caso que rechaza un modelo confirmado diferente del solicitado
(32 pruebas del ejecutor aprobadas). TypeScript, lint y empaquetado finalizaron sin
errores; permanecen el aviso anterior de dependencias de App.tsx y el aviso de
tamaño del bundle. Las cuatro pruebas del estudio de contexto también pasaron.
La oficina habitual se actualizó estando inactiva: conserva ocho proyectos,
diez conversaciones, 135 mensajes con las mismas huellas de contenido y las mismas
diez referencias de imágenes. Codex permanece como proveedor predeterminado.

Fuentes oficiales: [protocolo](https://antigravity.google/docs/cli/headless/),
[créditos](https://antigravity.google/docs/cli/credits/),
[configuración](https://antigravity.google/docs/settings?tab=cli),
[hooks](https://antigravity.google/docs/hooks/) y
[MCP](https://antigravity.google/docs/mcp/).

### Publicación y comprobación posterior

La integración se publicó en `0ff6a21c29c294d785cb58f6b687377c7de83a7a`.
La [ejecución de GitHub 40327075378](https://github.com/rubengp02/agents-sims/actions/runs/40327075378)
terminó con éxito, incluidos runtime sin inferencia, paquete Node 20 y los nueve
grupos E2E de Linux, Windows y macOS. Esto acredita compatibilidad de la aplicación
y sus pruebas simuladas; la inferencia real de Antigravity continúa acreditada
únicamente en Windows con la versión indicada en este documento.

Antes de publicar pasaron 106 pruebas de interfaz, 1.226 de servidor y ocho
contratos de empaquetado (dos pruebas de servidor omitidas). Tras extraer la
política de modelos pasaron sus seis regresiones nuevas y las 46 relacionadas.
Tipos, lint, formato, empaquetado, cuatro pruebas de contexto y ensayo simulado
del benchmark finalizaron correctamente. Se conservan el aviso previo de `editor`
en App.tsx y el de tamaño del bundle.

La actualización local posterior se hizo sin encargos activos. Conserva ocho
proyectos, diez conversaciones, 135 mensajes con las mismas huellas de contenido
y diez referencias de imágenes. El archivo completo de persistencia cambió de
huella al reiniciar; no se afirma identidad binaria ni de todos sus metadatos.
Se verificaron cero tareas activas y Codex como proveedor predeterminado.
