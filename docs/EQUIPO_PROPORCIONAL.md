# Un equipo proporcional a la petición

El Jefe responde directamente a descripciones de imágenes, traducciones,
explicaciones y resúmenes breves. Consulta sólo fuentes necesarias, reutiliza
contexto vigente y agrupa lecturas. No consulta pruebas de ejecución para
justificar una descripción ni convoca especialistas por rutina.

Esto se aplica en tres niveles: `AGENTS.md`, personalidad e instrucciones del
Jefe, y coordinador del servidor. El permiso permanente de escribir no convierte
una pregunta informativa en un encargo de implementación.

El servidor permite completar una petición breve sin Tester sólo si sigue
clasificada como informativa, no hubo empleados delegados y no cambió la revisión
del proyecto cuando existe captura de archivos. Las indicaciones nuevas vuelven
a evaluarse: pedir cambios o publicar no conserva la excepción. Análisis completos,
riesgos relevantes y tareas delegadas mantienen las reglas de revisión existentes.
No se afirma que hubo revisión del Tester cuando el Jefe respondió solo.

No hay un tope nuevo de llamadas ni se promete una cifra fija: una fuente que
falta puede requerir consultas adicionales. El objetivo es evitar coordinación y
lecturas sin utilidad; un especialista debe resolver una incertidumbre concreta.

Validación local sin cuota: 71 pruebas de conversaciones, memoria del objetivo,
decisiones y redirección; incluyen respuesta directa con permiso de escritura,
rechazo de cierre sin revisión para cambios, publicación e investigación completa,
y rechazo si cambian archivos durante una respuesta directa. Tipos, lint y
empaquetado comprobados. No se ha repetido esta validación con un modelo real:
el resultado prueba la política del servidor y el contenido de las instrucciones,
no garantiza que cada respuesta futura use exactamente una llamada.

## Continuaciones dentro de la misma conversación

El coordinador reconoce también seguimientos informativos acotados: «Incluye
también los siguientes pasos», «Resúmelo», «Explícalo mejor» y «Reformúlalo en cinco
puntos». Evalúa por separado el objetivo y sus indicaciones; una petición de
formato no borra un encargo de implementación, publicación o verificación.

Cada empleado conserva la revisión del objetivo para la que fue asignado. Una
lectura anterior completada puede reutilizarse en un seguimiento sin repetir su
revisión; un empleado de la versión actual, un Programador o un fallo pendiente
impiden esa excepción. Si llega una indicación durante una lectura, se conserva
la entrega y el recibo, se espera su parada y liberación de herramientas y sólo
entonces vuelve el control al Jefe. Un recibo normal de cancelación también marca
esa entrega como sustituida por la indicación; no sólo los errores de cancelación.

La preparación asigna el papel Jefe antes de seleccionar el modelo. Así una
respuesta informativa no se bloquea con la política de candidatos para escribir
código; esa protección sigue vigente para el Programador.

### Comprobación del 25 de octubre

95 pruebas locales aprobadas, incluidos el recorrido resumen → siguientes pasos →
cinco puntos en un mismo chat, la parada y liberación de un lector antes de
reorganizar y la conservación de revisión para código, publicación y fallos.
Tipos, lint y paquete comprobados; actualización aplicada con la oficina inactiva.

La prueba real con Codex desde la API de Conversaciones completó esas tres
peticiones, con una descripción textual autosuficiente: una ejecución del Jefe
por petición, cero llamadas a herramientas, cero Arquitectos y cero Testers.
Los tres recibos contienen consumo incluido conocido; el historial anterior a
la prueba conservó exactamente su huella. Evidencia privada:
`.local-office/followup-real/a3475f51-6c34-4346-9da2-92c8c147923e/evidence.json`.
No acredita una prueba nueva de visión ni que cualquier encargo deba usar cero
herramientas. El primer intento fue rechazado antes de inferencia por el error
de asignación de papel, corregido y cubierto por una prueba que mantiene intacto
el bloqueo de modelos candidatos para código.

## Desconexión posterior de Vercel

Por petición posterior del usuario se cerró la sesión OAuth local mediante el
CLI oficial y se deshabilitó la conexión de la oficina. El catálogo nuevo pasó
de `oAuth` a `notLoggedIn`. El primer intento no llegó al cierre: faltaba exponer
`logout` en el adaptador registrado. Se corrigió delegando al método oficial con
revalidación de identidad y URL; se preservó el recibo fallido y se probó que una
identidad distinta o una URL cambiada impiden desconectar. El nuevo recibo es
`signed_out`. No se manipularon credenciales ni se borraron proyectos. Evidencia
privada: `.local-office/vercel-signout-real/evidence.json`. Esto no acredita que
Vercel haya retirado el permiso remoto ni termina sesiones de clientes externos
que ya estén conectados; no se presenta como cierre completo del objetivo.
