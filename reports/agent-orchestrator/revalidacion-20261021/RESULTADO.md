# Revalidación autorizada: bloqueada antes de la inferencia

21 de octubre de 2026. Este ensayo conserva intacto el piloto anterior.

Se preparó una nueva comparación del caso medio entre Codex directo y la oficina
con Arquitecto, Programador y Tester, con gpt-6.1-sol y razonamiento medium.
Se fijaron antes de arrancar los mismos límites: cuatro llamadas, 400.000 tokens
y ocho minutos en total; 200.000 tokens y cuatro minutos por método, 180 segundos
por llamada, reserva de 20.000 tokens y sin reintentos ni ampliaciones.

## Resultado medido

El control oficial de suscripción impidió enviar la primera tarea: la ventana de
cinco horas estaba al 90 % de uso. La política existente reserva el 10 % restante.
La ventana semanal estaba al 14 %. La consulta oficial confirmó Plus y ausencia
de créditos adicionales. El reinicio comunicado para la ventana corta es el
21 de octubre a las 17:53:07, hora de Madrid; una consulta posterior deberá
verificar de nuevo su disponibilidad, sin asumir que el tiempo basta.

- Un intento de ejecución registrado; cero tareas enviadas a un modelo.
- Oficina sin iniciar; ninguna implementación ni reparación por IA.
- Contadores del proveedor: no disponibles porque se bloqueó antes de inferencia.
  El acumulador del ensayo permanece en cero; no se interpreta como ahorro.
- Duración del intento completo: 1.502 ms, incluida comprobación local del código
  inicial. Sus 10/36 pruebas superadas describen ese código inicial, no una solución.
- No hay comparación válida de calidad, rapidez, tokens ni caché entre métodos.

Se conserva [PILOTO_REAL.json](PILOTO_REAL.json) tal como se produjo. Su campo
`realInference: true` identifica el modo solicitado, no demuestra una llamada
real. La fila del intento registra correctamente `quota_reserve`. El resumen
histórico sustituyó esa causa por `usage_unknown` al encontrar contadores nulos;
se corrigió el registrador posteriormente para conservar la causa original.
No se alteró el registro ni se volvió a ejecutar el piloto tras corregirlo.

## Comprobaciones locales

Antes de intentar inferencia pasaron tipos, lint, pruebas de aplicación,
33 verificaciones del estudio y políticas, cinco escenarios nativos del puente
y empaquetado. Los verificadores rechazaron los tres códigos iniciales y aceptaron
las referencias fácil (15), media (36) y difícil (16). Esta preparación no gasta
cuota. Evidencia: [PREPARACION.json](PREPARACION.json) y
[validación local](../VALIDACION_LOCAL.json).

El script admite ahora un identificador de ensayo para separar las nuevas
autorizaciones y sus presupuestos sin borrar ni reiniciar registros cerrados.
También limita cada llamada al tiempo total restante. El identificador de este
intento es `revalidacion-20261021` y su registro privado está cerrado.

El motor predeterminado sigue siendo el anterior. Claude permanece desactivado y
Antigravity desconectado. No se alteraron diseño, animaciones ni credenciales.
Falta una comparación real completa cuando haya cuota disponible y se autorice
un nuevo intento; no se ha programado una reanudación automática.
