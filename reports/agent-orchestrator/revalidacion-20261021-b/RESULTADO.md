# Revalidación real: Arquitecto completado, aislamiento bloqueado

21 de octubre de 2026. Nueva autorización del usuario tras disponer de cuota.
Los intentos anteriores y este resultado se conservan sin reemplazarlos.

## Condiciones y resultado

Caso medio de factura en céntimos, mismo contrato, pruebas y archivos iniciales
(hashes coincidentes). Modelo solicitado gpt-6.1-sol, razonamiento medium en todos
los papeles; el proveedor no comunicó modelo confirmado. Máximo cuatro intentos,
400.000 tokens y ocho minutos en total; 200.000 tokens y cuatro minutos por método,
180 segundos por llamada. Sin reintentos ni ampliaciones.

| Método                   | Entrada | Salida | Caché incluida en entrada |  Total | Tiempo del método | Aceptación                                             |
| ------------------------ | ------: | -----: | ------------------------: | -----: | ----------------: | ------------------------------------------------------ |
| Codex directo            |  58.064 |  2.277 |                    45.184 | 60.341 |          71,676 s | 36/36, pruebas públicas y alcance correctos            |
| Oficina: solo Arquitecto |  43.249 |  1.188 |                    27.776 | 44.437 |          52,185 s | No aceptada: Programador bloqueado antes de inferencia |

Dos llamadas reales y un tercer intento local bloqueado al crear el espacio Git.
Consumo real comunicado total: **104.778 tokens**; tiempo total: **123,926 s**.
La suscripción se verificó antes de las dos llamadas reales. La consulta oficial
inicial mostró Plus, ventana corta al 0 %, semanal al 33 % y sin créditos
adicionales. No se usaron APIs de pago, recargas ni cambios de autenticación.

El Arquitecto entregó su diagnóstico completo y la cola lo aceptó. Queda validada
con IA real la reparación de la pérdida de respuesta del puente. El Programador
no llegó a recibir un turno y el Tester quedó en pausa. Las 10/36 comprobaciones
de la oficina describen el código inicial, sin implementación.

Los contadores nulos del intento de creación de carpeta no representan consumo
desconocido de un modelo: ese paso falló antes del envío. El contador de intentos
es tres; el de llamadas con inferencia es dos. Las dos sesiones reales fueron
nuevas; la caché observada no demuestra continuación de una sesión.

**No hay mejora demostrada en calidad, rapidez ni cuota.** La oficina falló en
fiabilidad y no completó el mismo trabajo. Su cifra menor de tokens no constituye
ahorro. El motor anterior sigue siendo el predeterminado.

## Diagnóstico y reparación local posteriores

Se reprodujo sin IA el error `ao_workspace_failed` usando la acción de espacios
Git del puente compilado. Git devolvió `Filename too long` al crear el archivo
de bloqueo de una referencia: una ruta fuente anidada y el identificador de
64 caracteres superaban el límite de Windows. La prueba anterior usaba una ruta
fuente más corta y no detectaba esta condición.

Se amplió el escenario nativo con una ruta de longitud representativa. Falló con
el código anterior y pasó tras acortar a 32 caracteres hexadecimales (128 bits)
el identificador del espacio y su rama. La clave privada de sesión y continuidad
mantiene sus 256 bits. No se cambiaron configuraciones globales de Git ni Windows.
Esto resuelve el caso reproducido, no promete soportar cualquier ruta arbitraria.

No se volvió a ejecutar inferencia tras reparar. El registro de este ensayo está
cerrado; no se reutilizará su presupuesto. Se ejecutó de nuevo la verificación
mecánica completa posterior; sus resultados están en
[VALIDACION_LOCAL.json](../VALIDACION_LOCAL.json).

Evidencia del ensayo: [preparación](PREPARACION.json) y
[resultado original sin modificar](PILOTO_REAL.json). Los diagnósticos con rutas
personales, respuestas y espacios de trabajo permanecen en el directorio privado
ignorado por Git. Claude continúa desactivado, Antigravity desconectado y no se
han cambiado la interfaz ni las animaciones.

Queda pendiente validar con una nueva ejecución real el circuito completo tras
esta reparación. Una sola pareja completada tampoco bastaría para concluir una
ventaja general para tareas fáciles, medias y difíciles.
