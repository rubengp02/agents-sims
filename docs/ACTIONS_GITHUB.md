# Comprobaciones alojadas en GitHub

El propietario hizo publico `rubengp02/agents-sims` el 22 de octubre de 2026 y
eligio ejecutar las comprobaciones en GitHub. Los ejecutores estandar de Linux,
Windows y macOS en repositorios publicos no consumen minutos facturables. Esto
no convierte en ilimitados otros productos, ejecutores grandes o almacenamiento.
No se cambia facturacion, presupuestos ni metodos de pago.

Se mantiene el CI multiplataforma existente: calidad, formato, build, paquete
instalado en Node 20 y nueve fragmentos E2E de Linux, Windows y macOS. Se añade
el job obligatorio **Agent runtime (sin inferencia)** con Node del proyecto,
Go fijado, AO fijado, pruebas de politicas y procesos, matriz de 72 combinaciones
y navegador standalone. Solo usa respuestas simuladas y procesos locales de
prueba; no inicia Codex o Claude reales.

El workflow CI admite tambien **Run workflow** sobre `main`. Sus checks
obligatorios incluyen el nuevo job. El despliegue existente sigue limitado a su
flujo de PR; lanzar manualmente CI no despliega ni publica una version.

El ensayo de registro de un ejecutor local se descarto al cambiar la decision:
se detuvo su proceso verificando PID y hora de creacion, se retiro el registro
con la aplicacion oficial y GitHub confirmo cero ejecutores propios. No llego a
ejecutar ningun job. No se instalo ningun servicio de inicio. Los archivos del
instalador y los diagnosticos privados se conservan fuera del repositorio;
no contienen una configuracion activa que permita recibir trabajos.

La publicacion anterior con `[skip ci]` evitaba iniciar ejecutores alojados
durante el intento local. Esta decision ya no se aplica al nuevo commit: el
CI alojado completo debe ejecutarse y verificarse; un resultado local o un job
omitido no sustituye una ejecucion verde de GitHub.
