/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Text in the emblem on the locomotives and driving trailer (e.g. CALM). */
  readonly VITE_LOCO_EMBLEM?: string;
  /** Lettering along the sides of the carriages (e.g. SUPPORTVERANTWORTUNG). */
  readonly VITE_CARRIAGE_LETTERING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
