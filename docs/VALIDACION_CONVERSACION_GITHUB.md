# GitHub desde una conversación persistida

Se utilizó la API local que sirve a Conversaciones, con sus protecciones de
origen y token, sin automatizar un navegador ni simular respuestas de modelo.
El acceso al navegador de esta sesión está desactivado en los ajustes de Work;
por tanto esta prueba no acredita la interacción visual ni capturas.

## Recorrido real comprobado

1. Se registró un proyecto de validación separado de AGENTS SIMS y se creó un chat
   nuevo, sin alterar la conversación del usuario.
2. Se guardó una petición de conexión GitHub de solo lectura. Se preparó un encargo
   individual sin permiso de escritura, con el ejecutor real Codex App Server y
   cuota incluida. El modelo no fue sustituido por un ejecutor de pruebas.
3. El empleado descubrió la consulta de identidad en `integrations_list` y solicitó
   `integration_call`. La autorización del objetivo cubría exactamente
   `github.get_user_login` con argumentos vacíos; el verificador aprobó solo esa
   petición y habría denegado cualquier otra operación.
4. Hubo una operación aprobada y completada, cero denegadas. El encargo terminó
   `completed`, sin publicación ni modificación en GitHub y sin exponer la identidad
   personal en la respuesta al usuario.
5. Se recuperaron los dos mensajes guardados, se cambió al chat original y se
   comprobó su hash, y se volvió al chat de prueba. Los mensajes de prueba fueron
   idénticos. Al finalizar se restauró la selección original.

La conversación de prueba permanece en el historial bajo el proyecto
«Validación GitHub desde Conversaciones». Los recibos completos y los hashes se
guardan en el estado privado ignorado; no deben publicarse.

## Ciclo posterior del Jefe con un Tester real

Después de incorporar las herramientas de aplicaciones y conexión de plugins,
se realizó una segunda prueba desde una conversación nueva y persistida:

- El Jefe revisó la disponibilidad y asignó a un único Tester la consulta de
  identidad autorizada. El Tester recibió permiso de solo lectura.
- La única operación remota fue `github.get_user_login` con argumentos vacíos:
  una aprobación, un recibo completado y cero operaciones denegadas.
- El Jefe recuperó el control, revisó la entrega y cerró el objetivo. Los dos
  turnos del Jefe comparten la misma sesión oficial; el Tester utiliza otra.
- Los tres recibos de ejecución terminaron correctamente y conservaron contadores
  verificables con facturación `subscription-only`. No hubo escritura en el
  proyecto de prueba, que conserva únicamente sus instrucciones originales.
- La conversación guarda ocho mensajes y se reabre sin cambios. Los hashes de
  las dos conversaciones previas permanecen idénticos. Al finalizar se restauró
  la conversación previamente seleccionada.

La evidencia privada conserva los recibos, el resultado y una auditoría separada
de las sesiones y permisos. La prueba acredita el ciclo **Jefe → Tester → Jefe**,
sin simular modelos o respuestas de GitHub. No acredita una operación de escritura
remota ni una autenticación nueva.

## Alcance y pendientes

La prueba acredita el backend real que usa Conversaciones, petición y respuesta
persistidas y reapertura, primero con un empleado individual y después con el
ciclo del Jefe y un Tester. No equivale a una aceptación visual del navegador ni
demuestra varios empleados simultáneos. Las pruebas anteriores se conservan por
separado, sin sustituir sus resultados.

El catálogo de aplicaciones bloqueado por HTTP 403 sigue identificado. Se ha
usado la herramienta anunciada por el puente oficial existente; no se han copiado
credenciales ni eludido la protección del endpoint del catálogo.
