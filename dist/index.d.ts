import { Plugin } from 'vite';

interface PluginOptions {
    /**
     * Take over the default import.meta.glob in Vite
     *
     * @default false
     */
    takeover?: boolean;
}

declare function export_default(options?: PluginOptions): Plugin;

export { export_default as default };
