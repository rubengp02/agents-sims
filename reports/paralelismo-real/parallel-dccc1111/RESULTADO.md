# Piloto real de dos escritores — 22 de octubre de 2026

**No demuestra una mejora del paralelismo.** Codex individual entregó un resultado
aceptado; la oficina ejecutó dos escritores simultáneos pero se detuvo por la
reserva de tokens de uno de ellos, antes de integrar. No se repitieron llamadas
ni se elevaron límites. El resultado desfavorable queda conservado.

La ejecución se realizó tras la aprobación explícita del usuario de los límites
del plan preparado. El código de partida corresponde al commit `60d7ead` y a la
huella registrada en el plan; las correcciones descritas abajo son posteriores.

## Medición

| Método                              | Aceptación completa              | Tokens entrada + salida                              | Tiempo de pared           |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------- | ------------------------- |
| Codex individual, sin delegación    | 50/50                            | 43.363 finales                                       | 41,246 s hasta aceptación |
| Oficina, dos escritores mediante AO | Sin candidato integrado aceptado | Al menos 131.363 observados; total final desconocido | 48,878 s hasta pausa      |

No se compara el tiempo de pausa de la oficina como si fuera tiempo de entrega.
El conjunto de ambas variantes tardó 90,251 segundos. La suma de duraciones
nativas de los dos trabajadores fue 67,190 segundos, distinta del tiempo de pared.

El baseline comunicó 41.948 tokens de entrada, 30.848 de ellos cacheados, y 1.415
de salida: 11.100 de entrada no cacheada. Los contadores observados de la oficina
fueron 129.690 de entrada, 87.936 cacheados, y 1.673 de salida. Estos últimos son
parciales porque no hubo cierre limpio de los turnos. La caché ya forma parte
de la entrada, y ninguna cifra equivale directamente a porcentaje de cuota.

El piloto registró tres llamadas reales, tres comprobaciones de suscripción
positivas y tres sesiones nuevas. Mismo CLI `0.163.0-alpha.10.2`, modelo solicitado
`gpt-6.1-sol` y razonamiento solicitado `low`. El modelo efectivamente utilizado
no fue comunicado en los recibos (`confirmedModel: null`); no se presenta como
confirmación algo que el proveedor no informó.

## Paralelismo y parada

AO creó dos worktrees desde el commit base común
`800d7d5c8bec494b8ab768a2c52762a9d5e89cfb`. Un Programador poseía `csv.mjs` y
el otro `graph.mjs`. Sus intervalos de ejecución nativa se solaparon **33,208 s**.
Esto acredita concurrencia de las ejecuciones; no mide cómo reparte cómputo
internamente el proveedor. No hubo Arquitecto, Jefe de IA ni revisor de IA:
el reparto local y la aceptación mecánica eran los previstos en el plan.

El trabajador de `graph.mjs` comunicó 75.463 tokens de entrada y 901 de salida
(76.364 en total), superando su reserva de 60.000. El adaptador detecta las
notificaciones de uso durante el turno, por lo que la pausa puede ocurrir antes
de su cierre final. El controlador canceló al otro escritor y conservó el flujo
en pausa. El total observado del piloto es al menos 174.726; **no se alcanzó el
límite global con los contadores conocidos**. La parada fue por la reserva
individual, no por haber demostrado un total global superior a 200.000.

Ambas copias conservadas pasan sus comprobaciones individuales después de la
parada: CSV 25/25 y grafo 23/23; instrucciones y pruebas permanecen intactas.
Estas comprobaciones fueron locales, sin nuevas llamadas a modelos. No se
integraron después de la pausa ni se ejecutó una reparación. Que cada mitad
pase no sustituye las dos pruebas de integración y la aceptación del conjunto.

La calidad `48 failures` del informe automático de oficina procede de ejecutar
la aceptación sobre el checkout original intacto al no existir candidato.
**No representa 48 defectos demostrados de las aportaciones de los trabajadores.**
La finalización del circuito y la calidad del candidato integrado quedan sin
acreditar, que es suficiente para excluir este intento como mejora admisible.

## Auditoría y corrección descubierta

El adaptador conservaba los últimos contadores numéricos en campos de total,
incluso si el turno terminaba cancelado o sin confirmación final. El piloto y el
coordinador podían interpretarlos como consumo completo conocido. Se corrigió:
las interrupciones conservan `observedUsage` como observación parcial y dejan
los totales finales en `null`. El verificador distingue también `usageComplete`
y `observedTokens`. Esto evita que números parciales permitan iniciar trabajo
nuevo o presentar un consumo final engañoso.

La nueva prueba reproduce el caso con un proveedor simulado que comunica uso
y se detiene por presupuesto antes de completar. No consume cuota real.
No se ha repetido el piloto con el arreglo ni se ha alterado su evidencia.

[RESULTADO.json](RESULTADO.json) permanece tal como lo escribió la ejecución.
Su SHA-256 es `c76bc1b506442f35f5afce69cb38ecd666bb2d879fe6781309c30737f42cc84d`.
[AUDITORIA.json](AUDITORIA.json) explica qué cifras son parciales, conserva la
atribución por recibo y corrige la interpretación sin reescribir el resultado
ni el diario privados originales. Los checkpoints finales dejan las dos tareas
y el flujo en pausa. No se observaban procesos `pixel-office-ao.exe` después del
cierre; esa comprobación no se presenta como una auditoría completa de todos
los procesos Codex del ordenador.

## Alcance de la conclusión

Es una pareja de mediciones sobre un encargo separable pequeño, con orden fijo
individual primero y motores distintos (CLI frente al adaptador AO). Hay sesgo
potencial de orden/caché y no se han evaluado tareas acopladas ni otras familias.
El tiempo de oficina incluye planificación local, preparación, ejecución y cierre
hasta la pausa; la integración no llegó a realizarse. No hay reparaciones ni
revisión de IA que añadir. No se extrapola a todos los problemas ni se atribuye
el exceso exclusivamente al contexto: cada trabajador recibe más contexto de
oficina, pero AO no ofrece aquí contadores de lecturas y herramientas comparables
a los del baseline. El origen exacto del exceso no queda aislado.

El siguiente experimento requeriría autorización nueva. Debe conservar este
baseline si mantiene exactamente encargo, aceptación, versión y demás condiciones
comparables, investigar contexto y uso por trabajador, y justificar las reservas
antes de consumir más cuota. No se aumentan automáticamente para conseguir un
resultado favorable. No hubo APIs de pago, créditos extra, Claude ni Antigravity.

## Regresión posterior, sin inferencia

Pasaron los 8 casos del piloto/protocolo, 13 pruebas focalizadas del adaptador,
59 de interfaz y 7 del contrato de paquete. La regresión amplia inicial tuvo
681/686 aprobadas y cinco agotamientos de tiempo en `parallelWorkflow.test.ts`.
Una repetición con un único worker de pruebas conservó tres agotamientos:
683/686 aprobadas. No se eliminan estos intentos ni se cambian plazos.

Se identificaron cuatro consultas separadas de Git por cada validación de
identidad de workspace. Tres respuestas compatibles se agruparon en una consulta
fresca: directorio Git concreto, directorio común y HEAD. Se conserva la consulta
del repositorio original y todas las comparaciones de rutas, identidad y base;
no se cachean permisos ni identidades. Las consultas por validación pasan de
cuatro a dos. No se atribuye a este cambio ningún ahorro del piloto ya terminado.

Con el cambio pasaron las 14 pruebas de worktrees con su límite original de
10 segundos por prueba (incluidos sustitución de copia, conflictos y aceptación
conjunta). Después pasaron las **686/686** pruebas del servidor en secuencia,
las seis comprobaciones de AO nativo con proveedor simulado y el empaquetado
(incluidos tipos y lint). Los registros detallados permanecen privados. Se
mantiene el aviso preexistente de lint sobre la dependencia `editor` de un
efecto de React; no se altera el diseño.
