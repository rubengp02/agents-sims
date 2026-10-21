# Etapa fácil: iniciada y pausada por presupuesto

21 de octubre de 2026. El usuario autorizó iniciar la primera etapa con el
presupuesto preparado. No autorizó media ni difícil. Se verificó que código y
protocolo coincidían con la preparación local antes de registrar la autorización.

Se ejecutó **Codex directo real** mediante el CLI oficial y la suscripción,
GPT-6.1 Sol solicitado con razonamiento bajo. El modelo confirmado no fue comunicado.
El control verificó la suscripción antes de ejecutar y el recibo original confirma
`subscription-only`. No hubo API de pago, créditos adicionales ni manipulación de
credenciales. Claude y Antigravity no se ejecutaron.

| Medida                                          |   Codex directo |
| ----------------------------------------------- | --------------: |
| Intentos CLI                                    |               1 |
| Comprobaciones funcionales externas             | 15/15 superadas |
| Pruebas públicas                                |       Superadas |
| Cambios fuera de alcance                        |         Ninguno |
| Entrada                                         |   56.141 tokens |
| Caché dentro de la entrada                      |   40.960 tokens |
| Entrada sin caché                               |   15.181 tokens |
| Salida                                          |      732 tokens |
| Total comunicado                                |   56.873 tokens |
| Tiempo de ejecución del ejecutor                |        28,544 s |
| Tiempo del método, con preparación y aceptación |        28,752 s |
| Tiempo completo de etapa, con diagnóstico común |        30,049 s |
| Herramientas comunicadas                        |               5 |
| Reintentos externos                             |               0 |

El código reparado cumple las 15 comprobaciones funcionales y solo cambió el módulo
permitido. **No se ha observado un defecto funcional en esas comprobaciones**.

La ejecución superó el umbral de **30.000 tokens comunicados por intento**. El CLI
informó del total al terminar el turno; el control pausó en ese momento. El límite
no permite cortar exactamente la generación antes de conocer ese consumo.
El presupuesto total de etapa sigue siendo 60.000: quedan 3.127 tokens, insuficientes
para reservar otro intento de 30.000.

Por eso no se inició la oficina. El registro quedó cerrado y pausado, sin aumentar
límites, reiniciar contadores ni consumir el segundo intento. Media y difícil
siguen sin autorización.

El informe automático marca el recorrido como `failed` y la etapa como `paused`:
la única comprobación negativa es `method-completed`, debida a la pausa por tokens.
Eso es un incumplimiento del presupuesto del protocolo, **no un fallo de las
15 pruebas funcionales**. Se conservan los datos originales sin corregirlos para
presentar un éxito o una comparación completa.

## Conclusión permitida

El presupuesto por intento preparado se quedó corto para esta tarea con herramientas.
Los tokens comunicados acumulan entradas de rondas sucesivas y caché: un prompt
de 774 caracteres no equivale a ese consumo total. No se deduce de aquí una cantidad
de dinero ni porcentaje de cuota.

**No hay comparación válida entre Codex directo y la oficina**, porque solo se
ejecutó el primer método. No se declara ganador ni ahorro. Completar la pareja
requeriría un nuevo presupuesto explícito y un protocolo de continuación que
conserve este intento; no se ha autorizado ni iniciado esa ampliación.

Datos originales: [easy-real.json](easy-real.json).
Verificación independiente del recibo, pruebas y límites:
[easy-auditoria.json](easy-auditoria.json).
