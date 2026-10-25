# MCP de un plugin seleccionado

El catálogo y las skills no garantizan que un MCP funcione. La oficina dispone de
un adaptador separado para conectar los MCP declarados de un plugin instalado y
habilitado, con procedencia inequívoca en el catálogo oficial.

## Recorrido

1. El Jefe consulta `plugin_capabilities` y encarga al Programador el trabajo que
   requiere programas nativos del plugin.
2. `plugin_mcp_tools` recibe el ID público del plugin. Antes de abrir el contexto
   pide aprobar el plugin, marketplace, servidores declarados y efectos de conexión.
3. Se consulta otra vez el catálogo. El CLI oficial recibe una configuración de
   contexto con ese plugin habilitado, los demás deshabilitados y hooks desactivados.
   Si la configuración efectiva no acredita esa selección, no se abre el turno.
4. Se verifica la sesión oficial y la cuota incluida antes del contexto técnico.
   No se inicia un turno de modelo: nunca se llama a `turn/start`. El contexto
   técnico usa permisos de lectura y rechaza solicitudes nativas inesperadas.
5. Se consultan todas las páginas de servidores de ese contexto. Sólo se aceptan
   herramientas cuyo `pluginId` coincide con el plugin seleccionado. Se devuelven
   identificadores públicos, esquemas y descripciones; la búsqueda y las páginas
   posteriores reutilizan la conexión, sin arrancar nuevos procesos.
6. `plugin_mcp_call` pide una aprobación nueva que muestra la herramienta concreta
   y sus argumentos. Después revalida procedencia y metadatos, registra el envío
   y llama al servidor exacto. El modelo no suministra sesiones internas ni comandos.
7. Al terminar o detener al empleado se cierra el contexto y sus conexiones.

## Permisos y límites reales

Los MCP nativos pueden ejecutar programas propios y sus efectos no se pueden
acreditar genéricamente como lectura. La conexión y las llamadas de este adaptador
corresponden al Programador con permiso de escritura. El contexto de lectura del
turno técnico no se presenta como garantía sobre todos los efectos internos del
programa MCP. Los lectores mantienen las herramientas de proyecto y las
integraciones adaptadas; pueden consultar capacidades y recibos del plugin.

Las descripciones y respuestas del plugin son datos externos. No amplían el
objetivo, eliminan aprobaciones ni permiten proveedores de IA de pago alternativos.
El motor anterior no se sustituye silenciosamente si carece de este adaptador.
Un plugin sin herramientas verificables conserva su limitación explícita.

## Cancelación, persistencia y recuperación

Cada conexión pertenece a la vida del empleado. Los identificadores caducan al
cerrarla; no se restauran transportes ni aprobaciones al abrir un historial o
reiniciar. `plugin_mcp_operations` consulta recibos sin ejecutar nada.

Se conserva el recibo antes de enviar la operación. Si la respuesta se pierde,
queda pendiente de revisión; no se reenvía automáticamente. La misma operación
con argumentos equivalentes permanece bloqueada después del reinicio, incluso
si cambia el orden de sus claves JSON. El recibo no contiene argumentos ni
resultados privados, sólo su huella, destino y estado. No se afirma que cancelar
el transporte deshaga los efectos que ya alcanzaron al programa o servicio.

## Evidencia

Pruebas simuladas: selección exclusiva y hooks desactivados, comprobación de cuota,
pertenencia del servidor, ausencia de inferencia, rechazo de herramientas de otro
plugin, aprobación antes de conectar y antes de cada llamada, argumentos ligados
a la aprobación, invalidación por cambios, exclusión de operaciones simultáneas,
recepción de errores, cierre, IDs caducados y resultados inciertos persistentes.

La prueba nativa real se registra por separado en el estado privado y debe
confirmar conexión, operación y retirada del plugin de prueba. La suite verde por
sí sola no acredita el funcionamiento real de un plugin de terceros ni su
autenticación. La comprobación visual de Conversaciones permanece pendiente por
indicación del usuario.

Validación real completada el 23 de octubre de 2026: plugin local temporal
`office-native-ece904ec`, MCP propio con una operación de eco. Se verificaron
instalación, ausencia de arranque antes de aprobar la conexión, configuración
efectiva con los demás plugins desactivados y hooks desactivados, catálogo real,
ausencia de llamadas antes de su aprobación y exactamente una llamada completada.
No hubo inferencia de modelo. La aprobación del piloto fue automatizada y sólo
admitía ese paquete propio y el texto sintético previsto; no representa una
interacción humana con la interfaz. Retirada verificada y ningún proceso del MCP
de prueba restante. El CLI oficial confirmó que ninguno de los cuatro paquetes
temporales utilizados durante el diagnóstico quedó instalado.

Se conservan los intentos fallidos anteriores: actualización global del catálogo
que agotaba el plazo y selección que no desactivaba entradas configuradas pero
ausentes del catálogo. No se habían ejecutado operaciones de sus MCP. La primera
retirada requirió revisión y se completó con el CLI oficial sobre el paquete propio;
no se repitió una instalación incierta. El adaptador ahora incluye esas entradas
configuradas en su selección y evita repetir innecesariamente la consulta posterior.
Para paquetes remotos conserva la actualización de procedencia y versión; sólo
los locales comprueban el estado local sin forzar la actualización global. Las
lecturas del catálogo admiten hasta 120 segundos; las mutaciones conservan su plazo
anterior, sin reenvío automático y con cancelación. Esto no limita la duración del objetivo.
