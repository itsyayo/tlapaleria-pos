-- 1. Tabla de Clientes (Quien debe)
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    saldo_actual NUMERIC(10, 2) DEFAULT 0.00, 
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Actualizar Tabla Ventas 
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id);
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'PAGADO'; 
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

-- 3. Tabla de Abonos
CREATE TABLE IF NOT EXISTS abonos (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER REFERENCES ventas(id),
    cliente_id INTEGER REFERENCES clientes(id),
    monto NUMERIC(10, 2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    forma_pago VARCHAR(50) DEFAULT 'Efectivo', 
    usuario_id INTEGER REFERENCES usuarios(id)
);