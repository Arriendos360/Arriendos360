const http = require('http');

const testApi = () => {
  console.log('🔍 Iniciando prueba de conexión al Backend...');

  http.get('http://localhost:3001/', (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        const response = JSON.parse(data);
        console.log('✅ Conexión exitosa al Backend!');
        console.log('--- Info de la API ---');
        console.log(`Mensaje: ${response.mensaje}`);
        console.log(`Versión: ${response.version}`);
        console.log('Endpoints disponibles:');
        Object.entries(response.endpoints).forEach(([key, val]) => {
          console.log(` - ${key}: http://localhost:3001${val}`);
        });
        console.log('----------------------');
      } else {
        console.log(`❌ El Backend respondió con código: ${res.statusCode}`);
      }
    });

  }).on('error', (err) => {
    console.log('❌ Error al conectar con el Backend. ¿Está corriendo el contenedor?');
    console.log('Detalle:', err.message);
  });
};

testApi();
