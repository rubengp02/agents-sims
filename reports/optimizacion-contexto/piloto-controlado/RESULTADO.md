# Piloto interrumpido: comparación no completada

21 de octubre de 2026. El usuario autorizó continuar tras la propuesta concreta de
cuatro ejecuciones, 480.000 tokens y 16 minutos totales, 120.000 tokens y tres
minutos de modelo por ejecución, sin reparaciones, reintentos ni aumentos automáticos.
La autorización privada se vinculó al [plan](PLAN.json) y a sus límites exactos.

Se intentó el primer brazo, Codex directo con contexto actual, Sol/low y sesión
nueva. El recibo confirma la comprobación inicial de suscripción ChatGPT y la
versión `0.163.0-alpha.10.2`. No existe resultado completado ni verificación final
del turno. Entrada, caché, salida y duración efectiva del modelo son desconocidas.

Durante el seguimiento, la herramienta de terminal devolvió `Unknown process id`
para la sesión que había iniciado el piloto. El informe y el recibo quedaron en
estado `running`, sin nuevos contadores. La comprobación posterior no encontró
el proceso Node del controlador ni un proceso Codex con el identificador de su
carpeta de trabajo en sus argumentos. No se mataron otros procesos ni se reinició
la aplicación, la cuenta o las credenciales.

Esto permite identificar una pérdida del controlador/canal de ejecución, pero
**no demuestra la causa de esa pérdida** ni cuánto trabajo llegó a procesar el
proveedor. No se atribuye a un límite de Git, de suscripción, a un fallo del modelo
o a la estrategia de contexto sin evidencia. El recibo parcial mostraba suscripción
verificada y no contenía un error del proveedor.

| Dato                                   | Resultado                                          |
| -------------------------------------- | -------------------------------------------------- |
| Despachos intentados                   | 1 de 4                                             |
| Ejecuciones completadas y aceptadas    | 0                                                  |
| Otros tres brazos                      | Sin iniciar                                        |
| Tokens de entrada / caché / salida     | Desconocidos                                       |
| Duración efectiva del modelo           | Desconocida                                        |
| Cambios en la implementación           | Ninguno                                            |
| Aceptación local tras la interrupción  | 10/36, código inicial sin resolver                 |
| Comparación válida o ahorro demostrado | Ninguno                                            |
| Estado del presupuesto                 | Cerrado y pausado; no reutilizable automáticamente |

Los diez casos superados pertenecen al código inicial: no son una implementación
entregada por el modelo. Las 26 comprobaciones fallidas se conservan en la evidencia
y no se rebajan para aceptar el intento. Los ceros del contador provisional no
se interpretan como consumo cero. Los contadores de actividad del recibo también
son parciales: no prueban ausencia de herramientas ni peticiones internas.

La ventana de observación hasta el cierre manual fue de 479,517 segundos. Incluye
espera y diagnóstico posterior y **no equivale a tiempo de modelo**. La pérdida del
controlador impide certificar el plazo efectivo de tres minutos mediante ese recibo.
El intento no cumple las condiciones de aceptación y no se presenta como eficiente.

Se cerró el registro privado con `execution_controller_lost`, consumo desconocido y
pausa permanente para este intento. No se iniciaron las otras tres llamadas y no
se reabrieron presupuestos. No se usaron Claude, Antigravity, APIs de pago ni
créditos adicionales. La interfaz y el código del producto permanecen iguales.

## Evidencia conservada

- [RESULTADO.json](RESULTADO.json): estado efectivo tras recuperar el registro;
  incluye el recibo parcial, aceptación local y brazos sin iniciar.
- [RESULTADO_ANTES_RECUPERACION.json](RESULTADO_ANTES_RECUPERACION.json): copia exacta
  del informe que quedó abierto, antes de corregir su estado.
- [INTERRUPCION.json](INTERRUPCION.json): observaciones de recuperación, huella de
  la copia original y resultados locales. El recibo nativo original permanece
  intacto en el directorio privado.

Se comprobaron por hash los 94 informes ya versionados antes de iniciar: todos
permanecen intactos. El código sigue coincidiendo con la huella preparada y con
la batería local anterior. Esta etapa no repitió inferencias ni modificó código.

Antes de otro piloto conviene reforzar el lanzamiento y la recuperación frente
a la pérdida del canal de terminal: propiedad de proceso registrada, supervisión
independiente del plazo y cierre como consumo desconocido al perder el controlador.
Es trabajo pendiente; no se presenta como implementado ni autoriza otra llamada.
Cualquier repetición necesita una autorización nueva con límites concretos.
