# Desactivar acceso a conexiones administradas

Herramientas y conexiones muestra las conexiones MCP HTTP administradas y permite
«Desactivar acceso de la oficina». El control usa la API local protegida y no
inicia un modelo ni contacta con el proveedor para cambiar permisos de cuenta.

Los empleados también pueden solicitar `connection_disable` con un identificador
guardado; en ese caso se muestra una propuesta con destino y alcance y se exige
aprobación de esa operación. El empleado no elige archivos, rutas ni comandos.

La desactivación se conserva fuera del proyecto con `enabled=false`. La conexión
queda bloqueada, se vacía su catálogo y se cancelan los transportes de las
operaciones locales en curso. Las nuevas llamadas se rechazan. Reiniciar no la
reactiva. Para reactivarla hay que proponer otra conexión y aprobarla; el servidor
no lo hace por abrir el historial.

Una operación que ya alcanzó el proveedor puede tener un resultado incierto. Se
conserva ese diagnóstico; cancelar el transporte no deshace una publicación ni
acredita que no se haya producido. No debe reenviarse automáticamente.

El resultado incierto bloquea nuevas operaciones incluso después de reiniciar o
reconectar. La interfaz pide comprobar el resultado en el proveedor y pulsar
«He comprobado el resultado en el proveedor». Esto retira el bloqueo para futuras
solicitudes; no repite la operación anterior. Un empleado no puede confirmar esa
revisión mediante una herramienta. Sólo se admite una operación activa por conexión.

## Diferencia respecto a revocar permisos de cuenta

Este control retira acceso desde la oficina. No elimina una cuenta, revoca tokens
del proveedor ni desinstala plugins oficiales. Revocar autorizaciones externas
requiere el mecanismo oficial del proveedor o un adaptador compatible y una
autorización concreta. No se presenta ese trabajo como completado con este botón.

Pruebas: desactivación persistente, rechazo de nuevas llamadas, cancelación de una
operación activa sin restaurar acceso, aprobación específica del empleado,
protección HTTP por origen/token y claridad del alcance en la interfaz.
