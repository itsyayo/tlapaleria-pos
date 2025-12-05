const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config(); // Cargar variables de entorno al inicio

// Importar rutas
const productosRoutes = require('./src/routes/productos');
const authRoutes = require('./src/routes/auth');
const proveedoresRoutes = require('./src/routes/proveedores');
const ventasRoutes = require('./src/routes/ventas');
const usuariosRoutes = require('./src/routes/usuarios');
const reportesRoutes = require('./src/routes/reportes');
const rangosRoutes = require('./src/routes/rangos');
const cotizacionesRoutes = require('./src/routes/cotizaciones');
const categoriasRoutes = require('./src/routes/categorias');
const inventarioRoutes = require('./src/routes/inventario');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/rangos', rangosRoutes);
app.use('/api/cotizaciones', cotizacionesRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/inventario', inventarioRoutes);
-
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    system: 'Tlapalería POS Backend', 
    version: '2.0.0',
    timestamp: new Date()
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`Servidor POS Tlapalería activo`);
  console.log(`URL Base: http://localhost:${PORT}`);
  console.log(`Carpeta de imágenes: ${path.join(__dirname, 'uploads')}`);
  console.log(`===============================================`);
});