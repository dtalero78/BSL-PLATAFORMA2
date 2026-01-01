-- Agregar campo stopBot a la tabla conversaciones_whatsapp
-- Este campo indica si el bot está detenido para esta conversación

ALTER TABLE conversaciones_whatsapp
ADD COLUMN IF NOT EXISTS "stopBot" BOOLEAN DEFAULT false;

-- Verificar que se agregó correctamente
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'conversaciones_whatsapp'
AND column_name = 'stopBot';
