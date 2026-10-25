# Revisar un resultado incierto desde Conversaciones

Herramientas y conexiones incluye «Resultados que necesitan revisión» para las
operaciones de plugins, MCP de plugins, integraciones oficiales y cierre OAuth
que ya generan recibos persistentes. Consulta el registro sin conectar servicios,
ejecutar modelos ni reanudar trabajo.

Cada entrada identifica la operación, destino, fecha del último registro cuando
consta y referencia del recibo. Las nuevas operaciones conservan también su tarea,
conversación y descripción, sin copiar el contenido de conversaciones privadas.
«Ver conversación original» permite volver a la petición si esa asociación existe.
Para recibos antiguos sin asociación no se inventa un chat: se indica que hay que
buscar la referencia original. La huella de argumentos no se presenta como su
contenido completo.

## Decisión humana

La pregunta es «¿Has comprobado si esta operación llegó a realizarse?». Las
respuestas son «Sí, he comprobado que se realizó» y «He comprobado que no se
realizó». Si no se conoce el resultado, se conserva pendiente. Registrar una
respuesta es una declaración humana, no una comprobación independiente del
proveedor ni autorización para otra operación.

Un resultado ya cerrado como incierto se puede revisar mientras la oficina sigue
trabajando. Si el recibo aún figura como envío sin cierre y hay trabajo activo,
el servidor rechaza la revisión hasta que termine o se detenga. El navegador no
puede saltarse ese control. Registrar la revisión no detiene ni reanuda la oficina,
no altera cuotas y no repite la operación. Cualquier acción posterior conserva su
aprobación específica; una propuesta ya utilizada nunca vuelve a ser ejecutable.

## Persistencia y controles

La revisión se guarda aparte, ligada al SHA-256 de los bytes originales del recibo.
No reescribe el recibo ni convierte su resultado desconocido en éxito automático.
Si ese recibo cambia, la revisión deja de aplicarse; las decisiones anteriores se
conservan en archivos por versión. Una decisión no puede reemplazarse por otra
mediante solicitudes simultáneas, incluso desde dos instancias del registro.

Los adaptadores consultan estas revisiones antes de permitir una nueva operación.
Sin revisión, las operaciones inciertas siguen bloqueadas. La integración oficial
normaliza las claves JSON para que reordenar argumentos no eluda el bloqueo. Un
recibo antiguo que no permite esa comparación conserva revisión obligatoria antes
de volver a usar la herramienta.

La API local usa identificadores opacos ligados a versión. No acepta rutas del
disco. GET consulta los recibos de directorios fijos de la oficina; POST exige
origen local, token de control, respuesta válida y estado compatible. Las
herramientas de los empleados no exponen una operación para autorrevisarse. Una
revisión declarada por un resultado o por el propio recibo no se considera válida.

Las conexiones HTTP mantienen su control previo de resultado incierto y
desactivación local; no se convierten silenciosamente a otro motor ni se les
atribuyen recibos de los otros adaptadores. Su autenticación administrada sigue
siendo un trabajo pendiente del objetivo.

## Evidencia

Pruebas locales sin cuota: conservación exacta de los recibos, revisión recuperada
por una instancia nueva, invalidación al cambiar datos, conservación de versiones,
rechazo de decisiones concurrentes, IDs inválidos y revisiones declaradas por una
operación, rutas protegidas, espera de envíos activos, revisión de resultados
cerrados durante otro trabajo y ausencia de ejecución al registrar la respuesta.

La prueba de integración usa un proveedor simulado: pérdida de respuesta,
bloqueo del intento equivalente, revisión humana registrada por el harness y
solicitud posterior explícita. La primera no se reenvía ni se borra. También se
comprueba que una instalación incierta necesita revisión y propuesta nueva.

Pruebas estáticas de interfaz verifican pregunta, respuestas, referencias, acceso
al chat original, aviso de evidencia incompleta y controles deshabilitados para
envíos activos. No acreditan una interacción visual real: esa aceptación continúa
pendiente por indicación del usuario. No se ha revisado automáticamente ningún
resultado incierto real de un proveedor.

Los recibos de plugins muestran además nombre, versión y marketplace registrados
en la propuesta, incluso si no proceden de una conversación. Los detalles pueden
mostrar la fase y una explicación de los códigos de fallo reconocidos. El
servidor transforma esos códigos mediante un catálogo cerrado: no envía el texto
privado del proveedor ni códigos desconocidos. Si un recibo antiguo carece de
diagnóstico, la interfaz indica que su causa no consta acreditada; no la deduce
de un fallo posterior. Las pruebas locales comprueban los campos públicos, la
omisión de datos privados y la presentación de ambos casos.
