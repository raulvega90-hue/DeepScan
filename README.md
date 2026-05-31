# RAUL VEGA • AI Deepscan — Netlify (clave protegida)

Escáner con datos reales de Finnhub. La clave de Finnhub vive en el
**servidor de Netlify** (nunca se descarga al navegador) y todo el sitio
está detrás de un **login con validación del lado servidor**.

## Estructura
```
netlify.toml                    ← config + redirects /api/* → función
public/index.html               ← el escáner (frontend, sin clave)
netlify/functions/scan.js       ← proxy a Finnhub (exige sesión)
netlify/functions/login.js      ← valida contraseña y emite sesión
```

## Despliegue (una sola vez)

1. **Sube esta carpeta a un repositorio de GitHub.**

2. En Netlify: **Add new site → Import from Git** → elige tu repo.
   Netlify detecta `netlify.toml` automáticamente. Deja la build vacía.

3. **Configura las 3 variables de entorno** en
   *Site configuration → Environment variables* (o por CLI):

   | Variable        | Valor                                                        |
   |-----------------|--------------------------------------------------------------|
   | `FINNHUB_KEY`   | tu clave de Finnhub                                          |
   | `APP_PASSWORD`  | la contraseña que tú elijas para entrar al sitio            |
   | `SESSION_TOKEN` | una cadena larga y aleatoria (ej. 40+ caracteres al azar)   |

   Por CLI sería:
   ```bash
   netlify env:set FINNHUB_KEY   "tu_clave_finnhub"
   netlify env:set APP_PASSWORD  "tu_contraseña"
   netlify env:set SESSION_TOKEN "una_cadena_larga_aleatoria_unica"
   ```

4. **Redeploy** el sitio (las variables se aplican en el siguiente deploy).

5. Abre tu URL de Netlify → te pide contraseña → entras → RUN DEEPSCAN.

## Por qué esto SÍ protege la clave
- El `index.html` no contiene la clave de Finnhub. Ver código fuente no la revela.
- El navegador llama a `/api/...`, que es una función serverless. La función
  añade la clave (desde `process.env`) del lado servidor y reenvía a Finnhub.
- Cada llamada exige la cookie de sesión (`HttpOnly`, no legible por JS) que
  solo se emite tras validar la contraseña en el servidor.

## Cómo generar un SESSION_TOKEN aleatorio
En cualquier terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Notas
- Si cambias `APP_PASSWORD` o `SESSION_TOKEN`, las sesiones activas se invalidan.
- La sesión dura 8 horas (configurable en `login.js`, `Max-Age`).
- Datos de acciones US en tiempo real (tier gratis). Fin de semana = último cierre.
- **No es asesoría financiera.** Herramienta educativa. Opera bajo tu propio riesgo.
```
