/** Jest con ts-jest: las pruebas del servicio son TypeScript, como el servicio. */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    // El tsconfig de compilacion solo incluye `src`; las pruebas necesitan su
    // propio ambito, asi que se le pasa el mismo compilador sin el `include`.
    transform: {
        '^.+\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true, strict: true, target: 'ES2022', module: 'CommonJS' } }]
    }
};
