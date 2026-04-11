const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ========== DIGITALOCEAN SPACES (Object Storage) ==========
const SPACES_ENDPOINT = 'https://nyc3.digitaloceanspaces.com';
const SPACES_REGION = 'nyc3';
const SPACES_BUCKET = process.env.SPACES_BUCKET || 'bsl-fotos';

const s3Client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    region: SPACES_REGION,
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET
    },
    forcePathStyle: false
});

/**
 * Sube una imagen base64 a DigitalOcean Spaces y retorna la URL pública
 * @param {string} base64Data - Imagen en formato base64 (con o sin prefijo data:image)
 * @param {string} numeroId - Número de identificación del paciente
 * @param {number|string} formId - ID del formulario
 * @returns {Promise<string|null>} URL pública de la imagen o null si falla
 */
async function subirFotoASpaces(base64Data, numeroId, formId) {
    try {
        if (!base64Data || base64Data.length < 100) {
            console.log('⚠️ subirFotoASpaces: base64 inválido o muy pequeño');
            return null;
        }

        // Detectar tipo de imagen
        let mime = 'image/jpeg';
        let ext = 'jpg';
        if (base64Data.startsWith('data:image/png')) {
            mime = 'image/png';
            ext = 'png';
        } else if (base64Data.startsWith('data:image/webp')) {
            mime = 'image/webp';
            ext = 'webp';
        }

        // Limpiar prefijo base64
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        if (buffer.length < 100) {
            console.log('⚠️ subirFotoASpaces: buffer demasiado pequeño');
            return null;
        }

        // Generar nombre único
        const timestamp = Date.now();
        const fileName = `fotos/${numeroId || 'unknown'}_${formId}_${timestamp}.${ext}`;

        // Subir a Spaces
        await s3Client.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: fileName,
            Body: buffer,
            ContentType: mime,
            ACL: 'public-read',
            CacheControl: 'max-age=31536000'
        }));

        const fotoUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${fileName}`;
        console.log(`📸 Foto subida a Spaces: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return fotoUrl;
    } catch (error) {
        console.error('❌ Error subiendo foto a Spaces:', error.message);
        return null;
    }
}

// Subir archivo multimedia a Digital Ocean Spaces para WhatsApp
async function subirMediaWhatsAppASpaces(buffer, fileName, mimeType) {
    try {
        // Generar nombre único
        const timestamp = Date.now();
        const ext = fileName.split('.').pop();
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `whatsapp-media/${timestamp}_${sanitizedName}`;

        // Subir a Spaces
        await s3Client.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            ACL: 'public-read',
            CacheControl: 'max-age=31536000'
        }));

        const mediaUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`;
        console.log(`📤 Media WhatsApp subido a Spaces: ${key} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return mediaUrl;
    } catch (error) {
        console.error('❌ Error subiendo media WhatsApp a Spaces:', error.message);
        throw error;
    }
}

/**
 * Sube el logo de un tenant a Spaces con clave tenants/{tenantId}/logo.{ext}
 * @param {Buffer} buffer - Buffer de la imagen
 * @param {string} tenantId - Identificador del tenant
 * @param {string} mimeType - MIME type (image/png, image/jpeg, image/webp)
 * @returns {Promise<string>} URL pública del logo
 */
async function subirLogoTenantASpaces(buffer, tenantId, mimeType) {
    try {
        let ext = 'png';
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
        else if (mimeType === 'image/webp') ext = 'webp';
        else if (mimeType === 'image/svg+xml') ext = 'svg';

        // Cache buster con timestamp para evitar caché stale del logo
        const key = `tenants/${tenantId}/logo_${Date.now()}.${ext}`;

        await s3Client.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            ACL: 'public-read',
            CacheControl: 'max-age=86400' // 1 día (permitir cambios frecuentes)
        }));

        const logoUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`;
        console.log(`🖼️  Logo tenant subido a Spaces: ${key} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return logoUrl;
    } catch (error) {
        console.error('❌ Error subiendo logo tenant a Spaces:', error.message);
        throw error;
    }
}

module.exports = {
    s3Client,
    subirFotoASpaces,
    subirMediaWhatsAppASpaces,
    subirLogoTenantASpaces,
    SPACES_BUCKET,
    SPACES_REGION,
    SPACES_ENDPOINT
};
