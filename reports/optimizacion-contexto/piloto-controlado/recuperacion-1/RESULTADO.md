# Recuperación funcional; repetición bloqueada por reserva de cuota

21 de octubre de 2026. El usuario autorizó reforzar la recuperación y repetir el
piloto con los mismos límites. El nuevo intento se lanzó una sola vez mediante
supervisor y vigilante independientes del terminal. El registro anterior permanece
cerrado e intacto; su consumo desconocido no se transforma en cero.

## Qué ocurrió realmente

El primer brazo, Codex directo con contexto actual, llegó a la verificación oficial
de suscripción. Codex devolvió `quota_reserve`: la política existente conserva el
último 10 % de cuota y rechaza empezar cuando una ventana ya ha consumido el 90 %
o más. El control falló antes de crear el proceso de ejecución y enviar el prompt.

La lectura oficial posterior de metadatos confirmó un **99 % consumido en la ventana
de cinco horas**, y un 49 % en la semanal. La renovación indicada para la ventana
de cinco horas es el **21 de octubre de 2026 a las 20:22:05, Europe/Madrid**.
[CUOTA.json](CUOTA.json) conserva solo los campos necesarios, sin identificadores
de cuenta, créditos de restablecimiento ni datos de autenticación. No se compró,
utilizó o restableció ningún crédito ni se modificó la cuenta.

| Control                                            | Resultado                            |
| -------------------------------------------------- | ------------------------------------ |
| Intentos nuevos de despacho                        | 1                                    |
| Encargos enviados al modelo                        | 0; bloqueo en la comprobación previa |
| Otros tres brazos                                  | Sin iniciar                          |
| Motivo nativo                                      | `quota_reserve`                      |
| Tiempo total de lanzamiento, comprobación y cierre | 12,789 s                             |
| Cambios de implementación en el caso               | Ninguno                              |
| Aceptación independiente local                     | 10/36: permanecía el código inicial  |
| Supervisor, controlador y vigilante al terminar    | Detenidos, verificado                |
| Registro del presupuesto                           | Cerrado y pausado, sin reintento     |
| Nueva comparación de tokens o rapidez              | No disponible                        |

No se presenta el 10/36 como una implementación del modelo ni como una pérdida de
calidad del contexto mínimo: ese brazo ni siquiera comenzó y el caso inicial ya
contenía errores conocidos. El motivo nativo y la ausencia de comprobación inicial
superada acreditan que el bloqueo ocurrió antes del envío; el código del ejecutor
asigna su versión y confirmación de suscripción antes de lanzar el proceso del
encargo, y aquí ambas quedaron sin asignar.

El [recibo bruto del piloto](RESULTADO.json) conserva entrada, caché y salida como
`null`, tal como las comunicó el ejecutor. El arnés etiqueta conservadoramente su
pausa global como `usage_unknown`, pero el recibo del brazo mantiene el motivo
específico `quota_reserve`. No es otra pérdida del controlador y no se alteran esos
datos para declarar éxito ni convertir contadores ausentes en mediciones cero.

## Qué se verificó de la recuperación

El lanzamiento ya no depende de recuperar un identificador de terminal. Se
registraron el supervisor, el vigilante y el controlador; el intento cerró de
forma normal en cuanto el control de cuota bloqueó el despacho. Se comprobó que
los tres procesos estaban detenidos y que no quedaba trabajador registrado.
Las siete pruebas locales específicas cubren además la pérdida abrupta de los
procesos, el cierre por plazo y la reconciliación tras perder los dos monitores.

Se verificaron los 98 informes previamente versionados, el registro privado del
intento anterior y la huella del código: permanecen intactos. No se han eliminado
pruebas ni cambiado la interfaz, personajes, escenarios o animaciones.
Claude continúa desactivado, Antigravity desconectado y AO opcional.

## Verificación local y siguiente paso

La batería final está en
[validacion-recuperacion-3.json](../../validacion-recuperacion-3.json): tipos, lint,
735 pruebas de aplicación/empaquetado, 47 pruebas de políticas/preparación,
siete pruebas de supervisión, puente nativo falso, matriz local y compilación
superados, con código estable e informes históricos conservados.

Los intentos locales fallidos y sus reparaciones se conservan en
[PRUEBAS_PROCESOS.json](../../recuperacion/PRUEBAS_PROCESOS.json) y en las validaciones
anteriores. El refuerzo se describe en
[IMPLEMENTACION.md](../../recuperacion/IMPLEMENTACION.md).

La repetición real queda pendiente de disponer otra vez de cuota por debajo del
umbral de protección. No se rebaja ese umbral, no se renueva el presupuesto cerrado
y no se programa una ejecución automática. La hora indicada es la previsión oficial
observada; cualquier nuevo intento deberá volver a comprobar cuota y disponibilidad.
Este intento no demuestra ahorro, y el coste acumulado de toda la investigación
sigue sin conocerse por el recibo perdido del intento anterior.
