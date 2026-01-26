const { calcularAnsiedad } = require('./calcular-ansiedad');
const { calcularDepresion } = require('./calcular-depresion');
const { calcularCongruencia } = require('./calcular-congruencia');

// Datos del registro de PostgreSQL para cédula 52154380
const registro = {
    "numero_id": "52154380",
    "primer_nombre": "ADRIANA",
    "primer_apellido": "VEGA",
    "cod_empresa": "SITEL",
    "de08": "Medianamente de acuerdo",
    "de29": "De acuerdo",
    "de03": "En desacuerdo",
    "de04": "Medianamente de acuerdo",
    "de05": "En desacuerdo",
    "de32": "Medianamente de acuerdo",
    "de12": "Medianamente en desacuerdo",
    "de06": "Medianamente en desacuerdo",
    "de33": "En desacuerdo",
    "de13": "Medianamente de acuerdo",
    "de07": "Medianamente de acuerdo",
    "de35": "De acuerdo",
    "de21": "Medianamente de acuerdo",
    "de14": "Medianamente en desacuerdo",
    "de15": "En desacuerdo",
    "de37": "Medianamente de acuerdo",
    "de16": "Medianamente de acuerdo",
    "de38": "Medianamente de acuerdo",
    "de40": "Medianamente de acuerdo",
    "de27": "Medianamente de acuerdo",
    "de20": "En desacuerdo",
    "an07": "En desacuerdo",
    "an11": "En desacuerdo",
    "an03": "Medianamente en desacuerdo",
    "an18": "De acuerdo",
    "an19": "Medianamente de acuerdo",
    "an04": "Medianamente de acuerdo",
    "an14": "Medianamente de acuerdo",
    "an09": "De acuerdo",
    "an20": "De acuerdo",
    "an05": "Medianamente de acuerdo",
    "an36": "Medianamente de acuerdo",
    "an26": "De acuerdo",
    "an31": "Medianamente de acuerdo",
    "an22": "De acuerdo",
    "an38": "En desacuerdo",
    "an27": "De acuerdo",
    "an35": "Medianamente de acuerdo",
    "an23": "De acuerdo",
    "an39": "De acuerdo",
    "an30": "Medianamente en desacuerdo",
    "cofv01": "De acuerdo",
    "corv11": "De acuerdo",
    "cofc06": "Medianamente de acuerdo",
    "coav21": "Medianamente en desacuerdo",
    "coov32": "Medianamente de acuerdo",
    "corc16": "De acuerdo",
    "coac26": "En desacuerdo",
    "cofv02": "Medianamente de acuerdo",
    "coov34": "En desacuerdo",
    "cofv03": "Medianamente de acuerdo",
    "corc17": "De acuerdo",
    "coac27": "De acuerdo",
    "cofc08": "De acuerdo",
    "cooc39": "De acuerdo",
    "cofc10": "En desacuerdo",
    "corv12": "De acuerdo",
    "cooc40": "De acuerdo",
    "corv15": "De acuerdo",
    "coac29": "Medianamente de acuerdo",
    "coov35": "De acuerdo",
    "coav24": "En desacuerdo",
    "corc18": "Medianamente de acuerdo",
    "coav25": "Medianamente en desacuerdo"
};

console.log('='.repeat(60));
console.log('RESULTADOS PRUEBAS PSICOLÓGICAS');
console.log('='.repeat(60));
console.log(`Paciente: ${registro.primer_nombre} ${registro.primer_apellido}`);
console.log(`Cédula: ${registro.numero_id}`);
console.log(`Empresa: ${registro.cod_empresa}`);
console.log('='.repeat(60));

// Calcular Ansiedad
const ansiedad = calcularAnsiedad(registro, registro.cod_empresa);
console.log('\n📊 ANSIEDAD:');
console.log(`   Valor: ${ansiedad.valor}`);
console.log(`   Interpretación: ${ansiedad.interpretacion}`);

// Calcular Depresión
const depresion = calcularDepresion(registro, registro.cod_empresa);
console.log('\n📊 DEPRESIÓN:');
console.log(`   Valor: ${depresion.valor}`);
console.log(`   Interpretación: ${depresion.interpretacion}`);

// Calcular Congruencia
const congruencia = calcularCongruencia(registro);
console.log('\n📊 CONGRUENCIA:');
console.log(`   Familia: ${congruencia.CongruenciaFamilia}`);
console.log(`   Relación: ${congruencia.CongruenciaRelacion}`);
console.log(`   Autocuidado: ${congruencia.CongruenciaAutocuidado}`);
console.log(`   Ocupacional: ${congruencia.CongruenciaOcupacional}`);

console.log('\n' + '='.repeat(60));
