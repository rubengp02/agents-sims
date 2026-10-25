# Revisión de proyectos grandes

Cambio autorizado el 23 de octubre de 2026: retirar los topes artificiales de
captura y copia de proyectos. El caso original detenía la oficina porque una
instalación de VS Code de pruebas se incluía entre los archivos revisados.

Se retiran los límites de 32 MB y 10.000 archivos de las capturas, así como los de
256 MB y 50.000 archivos de la copia de trabajo y el tope de profundidad. Esto no
convierte la memoria o el disco en recursos infinitos: el contenido se procesa
por bloques, con manifiestos de hashes y copias privadas en disco. El listado
de Git también se recoge en disco para evitar depender de un buffer máximo.

Las capturas nuevas usan manifiestos SHA-256 y archivos de contenido fuera del
proyecto. Los manifiestos anteriores con contenido base64 siguen siendo legibles
para construir revisiones. Se verifican el contenido guardado y los cambios del
archivo durante su captura. Los enlaces y rutas fuera del proyecto conservan
sus controles. Los recursos binarios que forman parte del proyecto se conservan;
no se excluyen por extensión ni por tamaño.

Los diffs que no caben en el resumen del turno se conservan completos en un
artefacto local, con una indicación explícita de leerlos por partes. El resumen
no se presenta como una revisión completa ni se acepta una salida sin las
evidencias y los controles de revisión existentes.

`.vscode-test` se excluye tanto de la captura como de la copia y la integración.
Los recibos de copias antiguas que incluían ese directorio siguen siendo legibles,
sin incorporar sus archivos generados al código revisado.

Las pruebas locales cubren archivos que superan 32 MB, más de 10.000 archivos,
una copia con un recurso de 257 MiB, evidencia modificada tras la revisión,
compatibilidad de recibos antiguos y diffs completos fuera del resumen.
La copia concreta que produjo el error también se capturó con el backend nuevo:
803 archivos, manifiesto de aproximadamente 97 KB y recibo antiguo recuperable.
No se ejecutaron modelos ni se reanudó automáticamente el objetivo del usuario.

Validación final: 917 pruebas de servidor aprobadas (dos opcionales omitidas),
72 pruebas de interfaz y empaquetado de producción con tipos y lint aprobados.
La primera ejecución general agotó los diez segundos de una prueba de Git bajo
carga; la repetición con treinta segundos de espera por prueba pasó completa.
Esto cambia la espera del comando de pruebas, no los límites del producto.
La oficina se dejó actualizada en el puerto 4173, inactiva y con los 30 mensajes
del historial intactos según comparación de contenido antes y después.
