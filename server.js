const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Base de datos en memoria (temporal)
let formularios = [];

// Ruta principal - servir el formulario
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para recibir el formulario
app.post('/api/formulario', (req, res) => {
    try {
        const datos = req.body;

        // Validación básica
        if (!datos.primerNombre || !datos.primerApellido || !datos.numeroId) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios'
            });
        }

        // Guardar en memoria
        const nuevoFormulario = {
            id: Date.now(),
            ...datos,
            fecha: new Date().toISOString()
        };

        formularios.push(nuevoFormulario);

        console.log('Formulario recibido:', nuevoFormulario);

        res.json({
            success: true,
            message: 'Formulario guardado correctamente',
            data: nuevoFormulario
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar el formulario'
        });
    }
});

// Ruta para obtener todos los formularios
app.get('/api/formularios', (req, res) => {
    res.json({
        success: true,
        total: formularios.length,
        data: formularios
    });
});

// Ruta para buscar por documento
app.get('/api/formulario/:numeroId', (req, res) => {
    const { numeroId } = req.params;
    const formulario = formularios.find(f => f.numeroId === numeroId);

    if (formulario) {
        res.json({ success: true, data: formulario });
    } else {
        res.status(404).json({
            success: false,
            message: 'Formulario no encontrado'
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
