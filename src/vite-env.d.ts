interface Window {
  Buffer: typeof import('buffer').Buffer;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}