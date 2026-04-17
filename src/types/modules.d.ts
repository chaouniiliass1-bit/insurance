// Minimal ambient declarations to satisfy TypeScript for ESM builds used in the app.

declare module 'uuid' {
  export function v4(): string;
}

declare module 'bcryptjs' {
  const bcrypt: {
    genSalt(rounds?: number): Promise<string> | string;
    hash(data: string, salt: string): Promise<string> | string;
    compare(data: string, hash: string): Promise<boolean> | boolean;
    genSaltSync?(rounds?: number): string;
    hashSync?(data: string, salt: string): string;
    compareSync?(data: string, hash: string): boolean;
  };
  export default bcrypt;
}

// Expo Constants stub to satisfy TypeScript in environments where types
// may not be available during tooling or web builds.
declare module 'expo-constants' {
  const Constants: any;
  export default Constants;
}