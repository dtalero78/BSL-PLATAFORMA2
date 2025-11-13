# Formulario Médico Ocupacional

Formulario simple en Node.js con Express para capturar información médica de pacientes.

## Instalación

```bash
npm install
```

## Uso

### Iniciar el servidor

```bash
npm start
```

El servidor estará disponible en: `http://localhost:3000`

### Modo desarrollo (con auto-reload)

```bash
npm run dev
```

## Estructura del proyecto

```
formulario/
├── server.js           # Servidor Express
├── package.json        # Dependencias
├── public/
│   ├── index.html     # Formulario HTML
│   ├── styles.css     # Estilos
│   └── script.js      # Validaciones y envío
└── README.md
```

## Endpoints API

### POST /api/formulario
Guarda un nuevo formulario médico.

**Body (JSON):**
```json
{
  "primerNombre": "Juan",
  "primerApellido": "Pérez",
  "numeroId": "1234567890",
  "celular": "3001234567",
  ...
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Formulario guardado correctamente",
  "data": { ... }
}
```

### GET /api/formularios
Obtiene todos los formularios guardados.

### GET /api/formulario/:numeroId
Busca un formulario por número de documento.

## Campos del formulario

### Datos Personales
- Primer Nombre *
- Segundo Nombre
- Primer Apellido *
- Segundo Apellido
- Número de Documento *
- Fecha de Nacimiento *
- Género *
- Estado Civil *

### Datos de Contacto
- Celular *
- Correo Electrónico
- Dirección
- Ciudad *

### Datos de Salud
- EPS *
- Tipo de Sangre
- Peso
- Altura

### Datos Laborales
- Empresa
- Profesión u Oficio *
- Cargo Actual

### Antecedentes de Salud
- Enfermedades actuales
- Medicamentos
- Cirugías
- Alergias

### Antecedentes Familiares
- Historial familiar de enfermedades

### Hábitos
- Tabaquismo
- Consumo de alcohol
- Ejercicio

### Observaciones
- Campo libre para información adicional

## Notas

- Los campos marcados con * son obligatorios
- Los datos se guardan en memoria (se pierden al reiniciar el servidor)
- Para persistencia, puedes conectar una base de datos (MongoDB, MySQL, etc.)
