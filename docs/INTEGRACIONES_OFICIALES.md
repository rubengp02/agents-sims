# Integraciones oficiales compartidas

La oficina consulta las herramientas del puente `codex_apps` que Codex ya tiene
registrado. No lee sus tokens, copia sesiones del navegador ni crea un proveedor
alternativo. El catálogo `app/list` y las herramientas MCP tienen comprobaciones
independientes: un fallo en el primero no acredita un fallo en las segundas.

## Recorrido

1. `integrations_list` busca nombres y devuelve páginas con identificador,
   descripción y esquema de argumentos. No envía el catálogo entero al contexto.
2. `integration_call` selecciona un identificador del catálogo y argumentos. La
   oficina presenta herramienta, descripción y argumentos para aprobación.
3. El servidor comprueba otra vez que la herramienta no cambió y crea una sesión
   técnica efímera, de solo lectura, con el proveedor oficial y sin inferencia.
   Solo permite llamar al puente oficial; el empleado no elige servidor ni sesión.
4. La cuenta y cuota se verifican. La llamada utiliza `mcpServer/tool/call`; sus
   resultados vuelven al empleado. Las peticiones nativas adicionales inesperadas
   se deniegan: la aprobación concreta no concede ampliaciones de permisos.
5. Un recibo registra herramienta, hash de argumentos, estado y fecha, sin guardar
   el contenido remoto. Un resultado incierto no se reenvía automáticamente;
   `integration_operations` recupera sus recibos. La protección se conserva al
   reiniciar y se aplica al mismo objetivo de oficina.

Las herramientas son comunes a los papeles. Las operaciones externas siguen
necesitando aprobación específica; un catálogo no autoriza escribir en GitHub.
Los permisos locales de lectura de un Tester no limitan por sí solos los efectos
de un servicio remoto: la autorización remota es un control distinto.

La recepción sin error verifica únicamente esa operación, no todas las capacidades
de la integración. El estado se muestra con identidad de operación, mientras que
el estado del catálogo de aplicaciones se muestra por separado.

## Validación real de GitHub

Se consultó el catálogo mediante el CLI oficial y se detectaron 91 herramientas
de GitHub. La operación de identidad `github.get_user_login` completó una llamada
de solo lectura sin error por el canal oficial, antes de la prueba con modelo.

Después se ejecutó un Tester real con Codex App Server y MCP de la oficina, en
una carpeta de validación separada. Descubrió la herramienta con `integrations_list`
y la utilizó con `integration_call`. La autorización humana del objetivo cubría
únicamente esta consulta de identidad con argumentos vacíos: el verificador
resolvió exclusivamente esa aprobación y habría denegado cualquier otra acción.
No hubo aprobación reutilizada, lectura de credenciales ni modificación remota.

El intento final quedó `completed`: una operación, una aprobación, cero acciones
denegadas y recibo de consumo verificable (73.461 tokens de entrada y 206 de salida).
El contexto cargado por Codex forma parte de esa entrada. El informe del Tester
no expone la identidad personal. Los recibos privados completos están en el estado
ignorado de validación; no deben publicarse.

Se conserva el primer intento: completó la consulta remota, pero el recibo del
modelo quedó en pausa por una cota de validación demasiado baja para el contexto
cargado (73.473 tokens de entrada y 224 de salida). No se borró ni se cambió su
estado. Se realizó una segunda prueba de solo lectura con cota revisada de forma
explícita; no hubo reenvío de una operación de resultado incierto.

## Límites de esta evidencia

La prueba usa el ejecutor, papel Tester, herramientas y aprobaciones de la oficina
con un modelo real; no es un recorrido visual completo desde un chat persistido
en el navegador. Tampoco demuestra publicación, modificación de repositorios,
autenticación nueva de aplicaciones alojadas ni disponibilidad de todos los
plugins. El 403 del catálogo de aplicaciones sigue identificado y no se elude.
Las pruebas locales cubren identidad del servidor, argumentos inmutables,
revalidación del esquema, cancelación, errores y recuperación sin reenvío.
