/** Jest con ts-jest: el paquete es TypeScript y sus pruebas tambien. */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    transform: {
        '^.+\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    esModuleInterop: true,
                    strict: true,
                    target: 'ES2022',
                    module: 'CommonJS',
                    // El tsconfig de compilacion solo declara `node`; las pruebas
                    // necesitan ademas los globales de jest.
                    types: ['node', 'jest']
                }
            }
        ]
    }
};
