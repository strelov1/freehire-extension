/**
 * Build-time configuration. WXT exposes `WXT_`-prefixed variables from the
 * `.env` files on `import.meta.env`; these merge into the interface it
 * generates. Absent (a plain `wxt dev`), the code falls back to localhost, so
 * development needs no env file at all.
 */
interface ImportMetaEnv {
  /** Where hire's API and sign-in live, e.g. https://freehire.me. */
  readonly WXT_HIRE_ORIGIN?: string;
  /** Where the Roy agent lives, e.g. https://agent.freehire.me. */
  readonly WXT_ROY_ORIGIN?: string;
}
