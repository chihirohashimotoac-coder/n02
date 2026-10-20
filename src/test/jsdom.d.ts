/**
 * The few jsdom entry points x01Stats.n01.test.ts uses to run n01's own scripts in a sandbox.
 * jsdom ships without type declarations and @types/jsdom is not a dependency.
 */
declare module 'jsdom' {
  export class VirtualConsole {
    on(event: 'jsdomError', listener: (error: Error) => void): this;
  }
  export interface ConstructorOptions {
    url?: string;
    runScripts?: 'dangerously' | 'outside-only';
    pretendToBeVisual?: boolean;
    virtualConsole?: VirtualConsole;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: unknown;
  }
}
