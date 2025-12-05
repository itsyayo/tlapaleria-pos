CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Tabla de Usuarios (Auth)
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) UNIQUE NOT NULL,
    contraseña VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'ventas', 'inventario')),
    activo BOOLEAN DEFAULT TRUE,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Proveedores
CREATE TABLE proveedores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE
);

-- 3. Tabla de Categorías
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT TRUE
);

-- 4. Tabla de Rangos de Utilidad
CREATE TABLE rangos_utilidad (
    id SERIAL PRIMARY KEY,
    rango numrange NOT NULL,
    porcentaje NUMERIC(5,2) NOT NULL,
    CONSTRAINT rangos_no_solapados EXCLUDE USING gist (rango WITH &&)
);

-- 5. Tabla de Productos
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT NOT NULL,
    ubicacion VARCHAR(100),
    stock_maximo INTEGER DEFAULT 0,
    stock_minimo INTEGER DEFAULT 0,
    cantidad_stock INTEGER DEFAULT 0,
    precio_compra NUMERIC(10,2) DEFAULT 0,
    precio_venta NUMERIC(10,2) DEFAULT 0,
    codigo_barras VARCHAR(100) UNIQUE,
    clave_sat VARCHAR(50),
    imagen TEXT,
    activo BOOLEAN DEFAULT TRUE,
    proveedor_id INTEGER REFERENCES proveedores(id),
    categoria_id INTEGER REFERENCES categorias(id)
);

-- 6. Tabla de Ventas
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total NUMERIC(12,2) NOT NULL,
    forma_pago VARCHAR(50),
    usuario_id INTEGER REFERENCES usuarios(id)
);

-- 7. Detalle de Venta
CREATE TABLE detalle_venta (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES productos(id),
    cantidad INTEGER NOT NULL,
    precio_unitario NUMERIC(10,2) NOT NULL,
    subtotal NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

-- 8. Tabla de Cotizaciones
CREATE TABLE cotizaciones (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cliente VARCHAR(150),
    forma_pago VARCHAR(50),
    total NUMERIC(12,2) DEFAULT 0,
    estado VARCHAR(20) DEFAULT 'PENDIENTE', 
    usuario_id INTEGER REFERENCES usuarios(id)
);

-- 9. Detalle de Cotizaciones
CREATE TABLE cotizaciones_detalle (
    id SERIAL PRIMARY KEY,
    cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES productos(id),
    descripcion TEXT, -- Se guarda por si cambia el producto después
    precio_unitario NUMERIC(10,2),
    cantidad INTEGER,
    subtotal NUMERIC(12,2)
);

-- Insertar usuario administrador por defecto
INSERT INTO usuarios (nombre, usuario, contraseña, rol) 
VALUES ('test', 'test', '$2b$10$7hyKxlRVmOLBNiKmi1mSFuFVscIf0s527f4Px4EmCBzhT5a6xE9OS', 'admin');