/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.json' {
  const value: any;
  export default value;
}
