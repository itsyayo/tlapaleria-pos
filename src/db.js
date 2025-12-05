const { Pool, types } = require('pg');
require('dotenv').config();

types.setTypeParser(1700, (val) => parseFloat(val)); 

types.setTypeParser(20, (val) => parseInt(val, 10));


const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  
  max: 20,
  idleTimeoutMillis: 30000, 
  connectionTimeoutMillis: 2000, 
});

pool.on('error', (err, client) => {
  console.error('Error inesperado en el cliente de PostgreSQL (Pool):', err);
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('------------------------------------------------');
    console.error('FATAL: No se pudo conectar a la Base de Datos.');
    console.error('   Verifica tu archivo .env y que PostgreSQL esté corriendo.');
    console.error(`   Error: ${err.message}`);
    console.error('------------------------------------------------');
  } else {
    console.log(`Conexión a Base de Datos exitosa [${process.env.DB_NAME}]`);
  }
});

module.exports = pool;