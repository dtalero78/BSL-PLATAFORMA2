-- ==========================================
-- TABLAS PARA INTEGRACIÓN CON ALEGRA
-- ==========================================

-- Tabla de configuración de facturación por empresa
CREATE TABLE IF NOT EXISTS configuracion_facturacion_empresa (
    id SERIAL PRIMARY KEY,
    cod_empresa VARCHAR(50) NOT NULL UNIQUE,

    -- Configuración de Alegra
    alegra_client_id VARCHAR(100), -- ID del cliente en Alegra para esta empresa

    -- Configuración de facturación
    terminos_condiciones TEXT,
    observaciones_default TEXT,
    dias_vencimiento INTEGER DEFAULT 30,
    incluir_retencion BOOLEAN DEFAULT false,
    porcentaje_retencion DECIMAL(5,2),

    -- Configuración de facturación electrónica Colombia (Alegra)
    payment_form VARCHAR(20) DEFAULT 'CREDIT', -- CASH o CREDIT
    payment_method VARCHAR(10), -- Método de pago (requerido si payment_form es CASH)
    tipo_factura VARCHAR(20) DEFAULT 'NATIONAL', -- NATIONAL, EXPORT, etc.
    generar_factura_electronica BOOLEAN DEFAULT true, -- Si debe generar stamp electrónico

    -- Metadata
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT fk_empresa FOREIGN KEY (cod_empresa)
        REFERENCES empresas(cod_empresa) ON DELETE CASCADE
);

-- Tabla de relación entre exámenes y sus IDs en Alegra
-- Permite mapear cada examen local con su producto/servicio en Alegra
CREATE TABLE IF NOT EXISTS examenes_alegra (
    id SERIAL PRIMARY KEY,
    examen_id INTEGER NOT NULL REFERENCES examenes(id) ON DELETE CASCADE,
    alegra_item_id VARCHAR(100) NOT NULL,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(examen_id)
);

-- Tabla de facturas generadas
CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY,

    -- Referencia a Alegra
    alegra_invoice_id VARCHAR(100) UNIQUE, -- ID de la factura en Alegra
    alegra_invoice_number VARCHAR(50), -- Número de factura generado por Alegra

    -- Datos de la factura
    cod_empresa VARCHAR(50) NOT NULL,
    fecha_factura DATE NOT NULL,
    fecha_vencimiento DATE,

    -- Montos
    subtotal DECIMAL(12,2) NOT NULL,
    impuestos DECIMAL(12,2) DEFAULT 0,
    retenciones DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,

    -- Estado
    estado VARCHAR(20) DEFAULT 'draft', -- draft, sent, paid, void
    fecha_pago TIMESTAMP,

    -- Metadata
    observaciones TEXT,
    terminos_condiciones TEXT,

    -- Auditoría
    creado_por INTEGER REFERENCES usuarios(id),
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    ultima_sincronizacion TIMESTAMP,

    CONSTRAINT fk_empresa_factura FOREIGN KEY (cod_empresa)
        REFERENCES empresas(cod_empresa)
);

-- Tabla de ítems de factura (detalle)
CREATE TABLE IF NOT EXISTS factura_items (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,

    -- Referencia al examen/paciente
    historia_clinica_id VARCHAR(100), -- _id de HistoriaClinica

    -- Datos del ítem
    descripcion TEXT NOT NULL,
    cantidad INTEGER DEFAULT 1,
    precio_unitario DECIMAL(12,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,

    -- Referencia a producto en Alegra
    alegra_item_id VARCHAR(100),

    -- Metadata del paciente (para referencia)
    paciente_nombre VARCHAR(200),
    paciente_numero_id VARCHAR(50),
    tipo_examen VARCHAR(100),
    fecha_examen DATE,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de sincronización con Alegra (logs)
CREATE TABLE IF NOT EXISTS alegra_sync_log (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER REFERENCES facturas(id) ON DELETE SET NULL,

    -- Tipo de operación
    operacion VARCHAR(50) NOT NULL, -- create_invoice, get_invoice, update_invoice

    -- Request/Response
    request_payload JSONB,
    response_payload JSONB,

    -- Estado
    exitoso BOOLEAN NOT NULL,
    codigo_http INTEGER,
    mensaje_error TEXT,

    -- Metadata
    timestamp TIMESTAMP DEFAULT NOW(),
    usuario_id INTEGER REFERENCES usuarios(id)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_facturas_cod_empresa ON facturas(cod_empresa);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON facturas(fecha_factura DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_alegra_id ON facturas(alegra_invoice_id);

CREATE INDEX IF NOT EXISTS idx_factura_items_factura ON factura_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_items_historia ON factura_items(historia_clinica_id);

CREATE INDEX IF NOT EXISTS idx_sync_log_factura ON alegra_sync_log(factura_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON alegra_sync_log(timestamp DESC);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_configuracion_facturacion_updated_at
    BEFORE UPDATE ON configuracion_facturacion_empresa
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comentarios para documentación
COMMENT ON TABLE configuracion_facturacion_empresa IS 'Configuración de facturación específica por empresa cliente';
COMMENT ON TABLE examenes_alegra IS 'Mapeo entre exámenes locales y productos/servicios en Alegra';
COMMENT ON TABLE facturas IS 'Registro de facturas generadas y sincronizadas con Alegra';
COMMENT ON TABLE factura_items IS 'Detalle de ítems (exámenes médicos) incluidos en cada factura';
COMMENT ON TABLE alegra_sync_log IS 'Log de auditoría de sincronización con API de Alegra';
