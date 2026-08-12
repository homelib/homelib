declare const console: {
  error(error: unknown): void;
  info(message: string): void;
};

declare function setTimeout(callback: () => void, delay: number): unknown;

declare function clearTimeout(timeout: unknown): void;
