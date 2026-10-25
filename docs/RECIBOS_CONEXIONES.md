# Recibos de llamadas MCP administradas

Cada nueva llamada guarda un identificador de operación antes de contactar con
la herramienta. El resultado devuelve ese identificador al empleado. El recibo
registra conexión, herramienta, encargo, conversación cuando consta, aprobación
real vinculada y huellas de argumentos, esquema y resultado. No guarda argumentos,
respuestas, credenciales ni datos personales del proveedor.

El Jefe y el Tester pueden consultar `connection_operations`, con un identificador
opcional de `connections_list`. La interfaz ofrece **Recibos de operaciones** en
cada conexión de **Herramientas y conexiones**. Consultar no llama al proveedor ni
inicia modelos. La ruta local usa identificadores registrados, sin aceptar rutas
del disco, y conserva la protección de origen.

El registro indica cuándo comenzó. Una lista vacía no demuestra ausencia de
llamadas históricas y no reconstruye la consulta anterior de Vercel.

## Estados y recuperación

- **Esperando resultado:** recibo guardado y llamada activa.
- **Completada:** respuesta MCP válida sin error.
- **Respondió con error:** respuesta MCP válida que declara un error.
- **Resultado incierto:** desconexión, cancelación después del envío, respuesta
  inválida o llamada que seguía pendiente al recuperar el proceso.
- **No enviada:** el intento preparado se detuvo antes del envío.

Un resultado incierto bloquea nuevas llamadas de esa conexión. El recibo también
permite recuperar el bloqueo si el proceso se interrumpió entre su escritura y
la del estado de la conexión. No se reenvía ninguna operación al leer, reiniciar,
reconectar o consultar el historial.

La revisión humana existente de conexiones conserva el recibo original y escribe
un reconocimiento aparte, ligado a sus bytes. Este reconocimiento no afirma si
la operación se realizó ni la repite. Otra llamada necesita otra aprobación.
La aprobación vinculada procede del control del servidor, no de argumentos
proporcionados por el empleado. Los identificadores de aprobación no se reutilizan.

## Validación

Pruebas locales con proveedores simulados y transporte MCP local: aprobación
antes del envío, recibos persistentes, conservación al reiniciar, ausencia de
contenido privado, espera activa, incertidumbre tras interrupción, revisión sin
reescribir el original, respuesta inválida y error explícito del proveedor.
Pruebas de API verifican origen y rechazo de conexiones no registradas. Pruebas
estáticas de interfaz verifican cobertura histórica, referencias y estados.
No sustituyen una aceptación visual ni una nueva operación real del proveedor.

## Comprobación real posterior

En **Validación de recibos**, el Jefe asignó la comprobación a un Tester real.
La persona aprobó una nueva consulta `list_teams {}` de Vercel, distinta de la
consulta histórica. El backend guardó exactamente un recibo nuevo, `completed`,
con la misma aprobación mostrada antes del envío, el encargo del Tester, la
conversación y las huellas de argumentos, esquema y resultado. El Tester releyó
el recibo sin otra consulta externa y el Jefe cerró el objetivo.

La auditoría del servidor contrastó el encargo y la aprobación, su fecha anterior
al envío y la huella de `{}`. Comprobó los registros reales completados con cuota
incluida. Un reinicio inactivo conservó idénticos el recibo y la aprobación, sin
nuevas llamadas. Los cinco chats y 80 mensajes permanecieron intactos, incluidos
los cuatro chats anteriores y sus 72 mensajes. La conversación de prueba conserva
ocho mensajes y Vercel mantiene su autenticación registrada.

La evidencia privada está en `.local-office/receipt-office/`; no se publican
respuestas ni datos personales del proveedor. El resultado no acredita llamadas
anteriores al inicio del registro, revocación o aceptación visual.
