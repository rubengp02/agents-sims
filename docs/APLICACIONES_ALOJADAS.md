# Aplicaciones alojadas desde Conversaciones

La oficina consulta dos fuentes oficiales diferentes. `apps_installed` muestra el
estado del runtime instalado (`enabled` y `callable`), mientras que `apps_list`
consulta el directorio general por páginas. El fallo de una fuente no sustituye
ni invalida automáticamente la otra. Un directorio con 403 conserva ese bloqueo;
no se enumeran identificadores adivinados ni se interpreta el fallo como un
directorio vacío.

## Recorrido

1. El Jefe busca primero una aplicación ya instalada, o consulta el directorio
   para otra aplicación. Los resultados identifican explícitamente su origen.
   Tras instalar un plugin, `plugin_capabilities.apps` anuncia también sus
   aplicaciones. El origen `plugin` requiere el identificador del paquete y
   comprueba que sigue instalado y habilitado; no necesita adivinar aplicaciones
   ni presentar un directorio bloqueado como operativo.
2. `app_connect` recibe el identificador anunciado y su origen (`installed` o
   `directory` o `plugin`). El servidor vuelve a comprobar su identidad, lee los metadatos
   oficiales y consulta el estado instalado.
3. Si ya está habilitada y permite herramientas, devuelve esa evidencia sin
   solicitar otro inicio de sesión. No ejecuta una herramienta ni da aprobación
   para acciones futuras.
4. Si necesita conexión, muestra una propuesta con destino, servicio y alcance.
   Una vez aprobada, revalida los datos y ofrece su página oficial dentro de
   Conversaciones. Sólo admite enlaces canónicos `https://chatgpt.com/apps/...`,
   sin credenciales, parámetros o redirecciones construidas por el modelo.
5. La persona completa la conexión en ChatGPT y, cuando corresponda, en el
   proveedor. Después pulsa **Ya he conectado, comprobar**. La oficina consulta
   de nuevo el runtime oficial con actualización; sólo continúa si la aplicación
   está habilitada y `callable`. Pulsar el botón no constituye prueba por sí solo.
   Si la consulta oficial responde pero no acredita herramientas habilitadas,
   el intento termina como no disponible para el ejecutor, sin volver a mostrar
   «Esperando inicio de sesión». Esto no afirma que la cuenta esté desconectada:
   una cuenta conectada en ChatGPT y un catálogo utilizable por Codex son estados
   distintos. No se pide repetir el inicio de sesión ni se cierra la cuenta.
   Una conexión MCP comprobada puede elegirse explícitamente como otra vía;
   no se sustituye el motor silenciosamente. Los intentos anteriores se conservan
   desplegados bajo «Intento anterior» cuando existe otro más reciente.
6. El empleado descubre las herramientas con `integrations_list` y solicita la
   operación concreta mediante `integration_call`, con su propia aprobación.

Cancelar, detener el encargo o caducar la espera conserva un recibo público y
cierra la comprobación pendiente. No se guarda el enlace en el historial privado
de autenticación. Reiniciar marca como cancelados los intentos inconclusos y no
reabre enlaces, comprueba cuentas ni ejecuta trabajo automáticamente.

Si caduca el inicio de sesión alojado del turno actual del Jefe, el coordinador
pausa el objetivo con una indicación concreta para completarlo. No despacha al
Tester ni acepta una finalización propuesta por el modelo mientras ese paso
siga pendiente. La revisión independiente sigue siendo necesaria para terminar
el objetivo; no se exige para reconocer una dependencia humana. Los recibos de
turnos anteriores no activan esta pausa en un turno nuevo. Cuando la persona
responde, se comprueba de nuevo el estado oficial, sin interpretar su texto como
prueba suficiente ni repetir una operación incierta.

El guardado de cada recibo se serializa: la publicación inicial, la comprobación
manual y el cierre no sustituyen el mismo archivo simultáneamente. Una prueba
simula el conflicto de archivos de Windows durante una comprobación correcta y
verifica que se conserva el resultado autenticado tras volver a cargarlo, sin
guardar la URL temporal. Esto es una prueba local de persistencia y no acredita
un inicio de sesión nuevo en un proveedor real.

## Gestionar o desconectar

`app_manage` consulta el estado y la página oficial de una aplicación conocida,
sin modificar su conexión. Desde esa página la persona puede revisar las cuentas
y desconectar cuando el proveedor y ChatGPT lo permitan. La interfaz de App Server
consultada expone metadatos y runtime, no una operación verificable de revocación
remota de permisos. No se sustituye esa ausencia por un cierre de ChatGPT,
`codex mcp logout codex_apps`, retirada de un plugin ni automatización del formulario.
Tampoco se presenta `callable: false` como prueba de revocación en el proveedor.

Las fuentes y sus diferencias están documentadas por OpenAI en
[App Server: aplicaciones y conectores](https://learn.chatgpt.com/docs/app-server).
La relación entre instalar, conectar y retirar un plugin está descrita en
[Plugins](https://learn.chatgpt.com/docs/plugins). Se contrastaron con los esquemas
del CLI instalado `0.163.0-alpha.11.2`.

## Evidencia

- Pruebas simuladas del catálogo, identidad anunciada, cambio de enlace tras
  aprobación, estado oficial posterior, cancelación, persistencia, recuperación
  y rechazo de enlaces ajenos al directorio oficial.
- Pruebas de presentación del enlace y botón de comprobación, sin pedir
  credenciales. La comprobación visual con navegador sigue pendiente.
- Comprobación real de ocho aplicaciones en el runtime instalado. GitHub figura
  habilitado y `callable`; `app/read` confirmó sus metadatos y enlace oficial.
  Las herramientas `apps_installed`, `app_connect` y `app_manage` de la oficina
  reconocieron esa conexión sin crear otra autorización. No hubo inferencia,
  credenciales copiadas ni modificaciones en el proveedor.
- El directorio `app/list` sigue devolviendo 403 en esa misma comprobación.
  No se utilizó el estado instalado para declarar que ese directorio funciona.
- Prueba real del origen `plugin`: el paquete GitHub instalado anunció su
  aplicación, la oficina revalidó sus metadatos y reconoció el acceso existente.
  No se creó una autorización ni se modificó el paquete o la cuenta.
- La API de la instancia actualizada responde 200 a «Comprobar herramientas»:
  runtime instalado disponible, directorio bloqueado y GitHub pendiente de una
  operación concreta. La consulta no inició trabajo del modelo.

No se ha conectado una cuenta nueva ni revocado una conexión real con este
recorrido. Esas acciones requieren la intervención de su titular y no se
acreditan con las simulaciones o con GitHub ya conectado.
